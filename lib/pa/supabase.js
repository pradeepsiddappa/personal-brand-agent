// ─────────────────────────────────────────────────────────
// supabase.js — server client + auth helper
// ─────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL) console.warn('[pa] SUPABASE_URL not set');
if (!SERVICE) console.warn('[pa] SUPABASE_SERVICE_ROLE_KEY not set');

/**
 * Admin client — bypasses RLS. Use only for auth flows and
 * cron jobs that need to act on behalf of users.
 */
function admin() {
  return createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * User client — respects RLS. Authenticates as the user whose
 * JWT is in the Authorization header. Call from API handlers.
 */
function forRequest(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  return createClient(URL, ANON, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Authenticate a request. Returns { user } or throws with a 401.
 */
async function requireUser(req) {
  const sb = forRequest(req);
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
  return { user: data.user, sb };
}

module.exports = { admin, forRequest, requireUser };
