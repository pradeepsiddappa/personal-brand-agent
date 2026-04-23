// POST /api/pa/settings/test
// Validate that a stored key actually works by making a test call.

const { requireUser, admin } = require('../../../lib/pa/supabase');
const { decrypt } = require('../../../lib/pa/crypto');
const { complete } = require('../../../lib/pa/claude');
const { sendMessage } = require('../../../lib/pa/telegram');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);
  const { key } = req.body || {};
  if (!key) return bad(res, 'key required');

  const sb = admin();
  const { data: s } = await sb.from('settings').select('*').eq('user_id', user.id).maybeSingle();
  if (!s) return bad(res, 'No settings saved yet');

  try {
    if (key === 'claude') {
      if (!s.claude_key_enc) throw new Error('No Claude key saved');
      const plain = decrypt(s.claude_key_enc);
      const { text } = await complete(plain, { user: 'Say "ok".', maxTokens: 10 });
      return ok(res, { ok: true, message: text });
    }
    if (key === 'telegram') {
      await sendMessage(user.id, 'Personal Agent test message ✓');
      return ok(res, { ok: true });
    }
    if (key === 'twitter') {
      // Ping Twitter users/me to validate the token
      const { getTwitterToken } = require('../../../lib/pa/twitter');
      const token = await getTwitterToken(user.id);
      const r = await fetch('https://api.twitter.com/2/users/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`users/me failed: ${r.status}`);
      const data = await r.json();
      return ok(res, { ok: true, user: data.data });
    }
    if (key === 'linkedin') {
      // Validate the access token by calling the OpenID /userinfo endpoint.
      // Also surface the member URN — without it, posting fails.
      const { getLinkedInToken } = require('../../../lib/pa/linkedin');
      const { token, memberUrn } = await getLinkedInToken(user.id);
      const r = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`userinfo ${r.status}: ${t.slice(0, 200)}`);
      }
      const info = await r.json();
      if (!memberUrn) {
        return ok(res, { ok: false, error: 'Token valid but member URN missing — reconnect to fetch it', profile: info });
      }
      return ok(res, { ok: true, profile: { name: info.name, email: info.email, sub: info.sub }, memberUrn });
    }
    return bad(res, `Test not implemented for ${key}`);
  } catch (e) {
    return ok(res, { ok: false, error: e.message });
  }
});
