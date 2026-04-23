// POST /api/pa/oauth/linkedin-start
//
// Returns { url } — the LinkedIn authorize URL.
// Called by the frontend via fetch (which can carry the auth header).

const crypto = require('crypto');
const { requireUser, admin } = require('../../../lib/pa/supabase');
const { handler, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  const { user } = await requireUser(req);

  const sb = admin();
  const { data: s } = await sb.from('settings')
    .select('linkedin_client_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!s?.linkedin_client_id) return bad(res, 'Set your LinkedIn client_id in Settings first');

  const state = Buffer.from(JSON.stringify({
    u: user.id,
    n: crypto.randomBytes(8).toString('hex'),
  })).toString('base64url');

  // PA_APP_URL points at the dashboard (e.g. https://yourdomain.com/pa),
  // but the callback lives at /api/pa/... on the origin. new URL() with an
  // absolute path drops PA_APP_URL's path and keeps only the origin.
  const redirectUri = new URL('/api/pa/oauth/linkedin-callback', process.env.PA_APP_URL).toString();
  const scopes = 'openid profile email w_member_social';

  const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', s.linkedin_client_id);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);

  ok(res, { url: authUrl.toString() });
});
