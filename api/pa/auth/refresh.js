// POST /api/pa/auth/refresh
// Exchanges a refresh_token for a fresh access_token via Supabase,
// so the dashboard doesn't force a new magic link every hour.

const { createClient } = require('@supabase/supabase-js');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { refresh_token } = req.body || {};
  if (!refresh_token) return bad(res, 'refresh_token required', 400);

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.refreshSession({ refresh_token });
  if (error || !data?.session) return bad(res, error?.message || 'Refresh failed', 401);

  const s = data.session;
  ok(res, {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_in: s.expires_in || 3600,
  });
});
