// ─────────────────────────────────────────────────────────
// url-reader.js — fetch a URL, extract readable text
// ─────────────────────────────────────────────────────────
// Used by the Telegram ambient-capture flow when the user sends
// links + asks for a synthesis. Pure regex-based extraction —
// no JSDOM / readability dependency. Good enough for blog posts,
// Substack, Medium, Dev.to, HN items, docs, and landing pages.
// ─────────────────────────────────────────────────────────

function stripTags(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPageText(url, opts) {
  opts = opts || {};
  const maxChars = opts.maxChars || 2000;
  const ac = new AbortController();
  const to = setTimeout(function () { ac.abort(); }, opts.timeoutMs || 10000);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'personal-agent-reader/1.0 (compatible; Mozilla/5.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();

    // Title: prefer <title>, fall back to first <h1>
    let title = '';
    const tMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (tMatch) title = stripTags(tMatch[1]).slice(0, 200);
    if (!title) {
      const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (h1) title = stripTags(h1[1]).slice(0, 200);
    }

    // OG description (often cleaner than body):
    let description = '';
    const descMatch = html.match(/<meta[^>]+(?:name|property)=['"](?:og:description|description)['"][^>]*content=['"]([^'"]*)['"][^>]*>/i)
      || html.match(/<meta[^>]+content=['"]([^'"]*)['"][^>]*(?:name|property)=['"](?:og:description|description)['"][^>]*>/i);
    if (descMatch) description = descMatch[1].slice(0, 400);

    // Body text: strip head + keep the rest
    const body = html.replace(/<head[\s\S]*?<\/head>/i, '');
    const text = stripTags(body).slice(0, maxChars);

    return { url, title, description, text };
  } finally {
    clearTimeout(to);
  }
}

// Pull all http(s) URLs out of a blob of text.
function extractUrls(text) {
  if (!text) return [];
  const re = /https?:\/\/[^\s<>'"]+[^\s<>'".,;!?)]/gi;
  return Array.from(new Set((String(text).match(re) || [])));
}

module.exports = { fetchPageText, extractUrls, stripTags };
