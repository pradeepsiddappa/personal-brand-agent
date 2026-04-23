// GET /api/pa/oauth/twitter-callback?code=...&state=...
// Exchanges the authorization code for access + refresh tokens.

const { admin } = require('../../../lib/pa/supabase');
const { encrypt, decrypt } = require('../../../lib/pa/crypto');
const { handler } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  const { code, state } = req.query || {};
  if (!code || !state) {
    res.status(400).send('Missing code or state');
    return;
  }

  const { u: userId, v: verifier } = JSON.parse(Buffer.from(state, 'base64url').toString());
  const sb = admin();
  const { data: s } = await sb.from('settings').select('*').eq('user_id', userId).maybeSingle();
  if (!s?.twitter_client_id || !s?.twitter_client_secret_enc) {
    res.status(400).send('Twitter client credentials not saved');
    return;
  }
  const clientId = s.twitter_client_id;
  const clientSecret = decrypt(s.twitter_client_secret_enc);
  const redirectUri = new URL('/api/pa/oauth/twitter-callback', process.env.PA_APP_URL).toString();

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    res.status(400).send(`Twitter token exchange failed: ${text}`);
    return;
  }
  const tok = await tokenRes.json();

  // Fetch handle
  let handle = null, twitterUserId = null;
  try {
    const meRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json();
      handle = me.data?.username;
      twitterUserId = me.data?.id;
    }
  } catch { /* ignore */ }

  await sb.from('settings').update({
    twitter_access_token_enc: encrypt(tok.access_token),
    twitter_refresh_token_enc: encrypt(tok.refresh_token || ''),
    twitter_expires_at: new Date(Date.now() + (tok.expires_in || 7200) * 1000).toISOString(),
    twitter_handle: handle,
    twitter_user_id: twitterUserId,
  }).eq('user_id', userId);

  res.redirect(`${process.env.PA_APP_URL}?tab=settings&twitter=connected`);
});
