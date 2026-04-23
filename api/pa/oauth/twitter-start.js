// POST /api/pa/oauth/twitter-start
//
// Returns { url } — the Twitter authorize URL the browser should navigate to.
// The frontend calls this via fetch (carrying the user's JWT) instead of
// relying on a plain <a href> redirect that can't send auth headers.

const crypto = require('crypto');
const { requireUser, admin } = require('../../../lib/pa/supabase');
const { handler, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  const { user } = await requireUser(req);

  const sb = admin();
  const { data: s } = await sb.from('settings')
    .select('twitter_client_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!s?.twitter_client_id) return bad(res, 'Set your Twitter client_id in Settings first');

  // PKCE pair + state with user id
  const code_verifier  = crypto.randomBytes(32).toString('base64url');
  const code_challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
  const state = Buffer.from(JSON.stringify({ u: user.id, v: code_verifier })).toString('base64url');

  const redirectUri = new URL('/api/pa/oauth/twitter-callback', process.env.PA_APP_URL).toString();

  // media.write lets Publisher upload branded PNG cards before posting.
  const scopes = 'tweet.read tweet.write users.read media.write offline.access';

  const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', s.twitter_client_id);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', code_challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  ok(res, { url: authUrl.toString() });
});
