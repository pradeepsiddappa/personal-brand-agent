// POST /api/pa/settings/bulk-voice
// Accept a chunk of text (tweets separated by blank lines), insert each
// block as a voice_examples row. Faster than forwarding one-by-one via
// Telegram when you've collected 20+ inspiration tweets.
// Body: { text }

const { requireUser, admin } = require('../../../lib/pa/supabase');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return bad(res, 'text required');

  // Split on two-or-more consecutive newlines = blank-line separator.
  const chunks = text.split(/\n\s*\n+/)
    .map(function (c) { return c.trim(); })
    .filter(function (c) { return c.length >= 10 && c.length <= 2000; });

  if (chunks.length === 0) return bad(res, 'No valid chunks found (need 10-2000 chars, separated by blank lines)');

  const rows = chunks.map(function (t) {
    // Detect a tweet URL so we can fill source_url separately.
    const urlMatch = t.match(/https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/[A-Za-z0-9_]+\/status\/\d+/i);
    return {
      user_id: user.id,
      text: urlMatch ? t.replace(urlMatch[0], '').trim() || urlMatch[0] : t,
      source: 'manual-bulk',
      source_url: urlMatch ? urlMatch[0] : null,
    };
  });

  const sb = admin();
  const { error } = await sb.from('voice_examples').insert(rows);
  if (error) return bad(res, error.message);

  ok(res, { added: rows.length });
});
