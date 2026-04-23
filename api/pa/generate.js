// POST /api/pa/generate
// Ambient-capture entry — creates a single draft from user-supplied
// seed text + optional URLs, in the chosen format.
// Body: { seed_text, urls, format }  // format: tweet | thread | longpost | quote-tweet

const { requireUser } = require('../../lib/pa/supabase');
const { generateFromSeed } = require('../../lib/pa/agent-runner');
const { handler, allow, ok, bad } = require('../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);
  const { seed_text, urls, format } = req.body || {};
  const allowedFormats = ['tweet', 'thread', 'longpost', 'quote-tweet'];
  if (format && allowedFormats.indexOf(format) === -1) {
    return bad(res, 'format must be one of: ' + allowedFormats.join(', '));
  }
  try {
    const draft = await generateFromSeed(user.id, {
      seed_text: String(seed_text || ''),
      urls: Array.isArray(urls) ? urls : [],
      format: format || 'tweet',
    });
    ok(res, { ok: true, draft });
  } catch (e) {
    return bad(res, e.message);
  }
});
