// ─────────────────────────────────────────────────────────
// github.js — minimal GitHub REST client for SEO auto-commit
// ─────────────────────────────────────────────────────────
// Uses the user's PAT (Personal Access Token) — fine-grained scope:
//   - Contents: Read & Write (for the target repo only)
//
// We only support a single-file edit per commit, by string replace.
// The agent supplies (file, old_content, new_content). Old must
// appear exactly once in the file; otherwise we fail loud rather
// than guess.
// ─────────────────────────────────────────────────────────

const { admin } = require('./supabase');
const { decrypt } = require('./crypto');

async function getGithubConfig(userId) {
  const sb = admin();
  const { data: s, error } = await sb.from('settings')
    .select('github_token_enc, github_repo, github_branch')
    .eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!s?.github_token_enc) throw new Error('GitHub token not set in Settings');
  if (!s?.github_repo)      throw new Error('GitHub repo not set in Settings (e.g. "owner/repo")');
  return {
    token: decrypt(s.github_token_enc),
    repo: s.github_repo,
    branch: s.github_branch || 'main',
  };
}

async function ghFetch(token, path, opts) {
  opts = opts || {};
  const r = await fetch('https://api.github.com' + path, {
    method: opts.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'personal-agent/1.0',
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error('GitHub ' + r.method + ' ' + path + ' → ' + r.status + ': ' + t.slice(0, 200));
  }
  return r.json();
}

async function getFile(userId, filePath) {
  const { token, repo, branch } = await getGithubConfig(userId);
  const data = await ghFetch(token, '/repos/' + repo + '/contents/' + encodeURIComponent(filePath) + '?ref=' + encodeURIComponent(branch));
  // contents API returns base64-encoded content.
  const buf = Buffer.from(data.content, 'base64');
  return { content: buf.toString('utf8'), sha: data.sha };
}

async function putFile(userId, filePath, newContent, message, sha) {
  const { token, repo, branch } = await getGithubConfig(userId);
  const body = {
    message: message,
    content: Buffer.from(newContent, 'utf8').toString('base64'),
    branch: branch,
  };
  if (sha) body.sha = sha;
  return ghFetch(token, '/repos/' + repo + '/contents/' + encodeURIComponent(filePath), {
    method: 'PUT',
    body: body,
  });
}

// Apply a single string-replace edit and commit it. Returns the new commit SHA.
async function applyEdit(userId, { file, oldContent, newContent, commitMessage }) {
  if (!file || !oldContent || !newContent) throw new Error('file, oldContent, newContent are all required');
  const current = await getFile(userId, file);

  const occurrences = current.content.split(oldContent).length - 1;
  if (occurrences === 0) throw new Error('old_content not found in ' + file + ' — file may have changed since the audit');
  if (occurrences > 1)   throw new Error('old_content matches ' + occurrences + ' times in ' + file + ' — anchor needs to be unique');

  const updated = current.content.replace(oldContent, newContent);
  const result = await putFile(userId, file, updated, commitMessage || 'SEO: auto-applied recommendation', current.sha);
  return result?.commit?.sha || null;
}

module.exports = { getGithubConfig, getFile, putFile, applyEdit };
