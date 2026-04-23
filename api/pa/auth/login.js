// POST /api/pa/auth/login
// Issues a magic link via Supabase. Checks allowlist first.

const { admin } = require('../../../lib/pa/supabase');
const { isAllowed } = require('../../../lib/pa/allowlist');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { email } = req.body || {};
  if (!email) return bad(res, 'Email required');
  if (!isAllowed(email)) return bad(res, 'This email is not on the allowlist', 403);

  const sb = admin();
  const redirectTo = `${process.env.PA_APP_URL || ''}/auth`;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
  });
  if (error) return bad(res, error.message);
  ok(res, { sent: true });
});
