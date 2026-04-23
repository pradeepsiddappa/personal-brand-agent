// POST /api/pa/pipeline/tweak-draft
// Re-write an existing draft's text in-place using a one-line AI instruction.
// Examples: "make it more casual", "shorter", "lead with the number",
// "remove the hashtags", "make it less salesy".
//
// We feed Claude the existing text + the user's tweak instruction and
// ask for a single revised version. Image, draft_type, platforms stay
// the same — only the text + text_linkedin change.

const { requireUser, admin } = require('../../../lib/pa/supabase');
const { decrypt } = require('../../../lib/pa/crypto');
const { complete } = require('../../../lib/pa/claude');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

function parseJson(raw) {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  try { return JSON.parse(body.trim()); } catch { return null; }
}

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);
  const { draft_id, instruction } = req.body || {};
  if (!draft_id || !instruction) return bad(res, 'draft_id and instruction required');

  const sb = admin();
  const { data: draft } = await sb.from('drafts').select('*').eq('id', draft_id).eq('user_id', user.id).maybeSingle();
  if (!draft) return bad(res, 'Draft not found', 404);

  const { data: settings } = await sb.from('settings').select('*').eq('user_id', user.id).maybeSingle();
  const claudeKey = settings?.claude_key_enc ? decrypt(settings.claude_key_enc) : null;
  if (!claudeKey) return bad(res, 'Claude API key not set in Settings');

  const brandVoice = settings?.brand_voice || '';
  const isThread = draft.draft_type === 'thread';
  const isLong   = draft.draft_type === 'longpost';

  // Pull in the exact same OWNED URLS context so the rewrite respects
  // first-person rules.
  const refLinks = String(settings?.reference_links || '');
  const ownedHosts = Array.from((refLinks.match(/https?:\/\/([a-z0-9.-]+)/gi) || []).reduce(function (acc, u) {
    try { acc.add(new URL(u).host.replace(/^www\./, '')); } catch {}
    return acc;
  }, new Set()));

  const prompt = [
    'Rewrite the draft below based on the user\'s instruction. Return JSON only.',
    '',
    brandVoice ? 'BRAND VOICE (still applies):\n' + brandVoice + '\n' : '',
    ownedHosts.length ? 'OWNED URLS — write about these in first-person or project-as-subject (NEVER "Someone built"):\n' +
      ownedHosts.map(function (h) { return '  • ' + h; }).join('\n') + '\n' : '',
    'CURRENT DRAFT:',
    'text (Twitter): ' + (draft.text || ''),
    isThread && Array.isArray(draft.thread_parts)
      ? 'thread_parts: ' + JSON.stringify(draft.thread_parts) : '',
    draft.text_linkedin ? 'text_linkedin (LinkedIn): ' + draft.text_linkedin : '',
    '',
    'USER INSTRUCTION:',
    instruction.slice(0, 500),
    '',
    'RULES:',
    '- Keep the SAME draft_type (' + (draft.draft_type || 'single') + '). Do NOT change tweet to thread or vice versa.',
    isThread ? '- Return thread_parts as an array of 2-5 tweets, each ≤ 280 chars.' :
    isLong   ? '- Return text as a single LinkedIn-native long post (400-2500 chars).' :
               '- Return text as a single tweet, ≤ 280 chars.',
    '- Always also rewrite text_linkedin (400-1200 chars, paragraphs, no arrow bullets).',
    '- NO new product/company names, NO invented facts. Only use what\'s in the original or BRAND VOICE.',
    '',
    'Return JSON:',
    isThread
      ? '{ "text": "first tweet (hook)", "thread_parts": ["tweet 1", "tweet 2", ...], "text_linkedin": "..." }'
      : '{ "text": "the rewritten ' + (isLong ? 'long post' : 'tweet') + '", "text_linkedin": "..." }',
  ].filter(Boolean).join('\n');

  const { text: raw } = await complete(claudeKey, {
    system: 'You revise drafts based on user instructions. Return ONLY valid JSON.',
    user: prompt,
    maxTokens: 2500,
  });

  const parsed = parseJson(raw);
  if (!parsed || !parsed.text) {
    console.warn('[pa] tweak-draft parse failed. Raw:', (raw || '').slice(0, 400));
    return bad(res, 'AI returned invalid output. Try a simpler instruction.');
  }

  const update = {
    text: String(parsed.text).slice(0, isLong ? 3000 : 280),
    text_linkedin: parsed.text_linkedin ? String(parsed.text_linkedin).slice(0, 3000) : draft.text_linkedin,
  };
  if (isThread && Array.isArray(parsed.thread_parts)) {
    update.thread_parts = parsed.thread_parts.slice(0, 5).map(function (t) { return String(t).slice(0, 280); });
  }
  await sb.from('drafts').update(update).eq('id', draft_id);

  await sb.from('events').insert({
    user_id: user.id, agent: 'human', kind: 'review',
    title: 'Tweaked ' + draft_id + ' (AI)',
    detail: instruction.slice(0, 200),
    tag: 'tweaked', ref_id: draft_id,
  });

  ok(res, { ok: true, text: update.text, text_linkedin: update.text_linkedin, thread_parts: update.thread_parts });
});
