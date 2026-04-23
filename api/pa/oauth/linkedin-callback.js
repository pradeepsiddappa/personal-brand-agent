// GET /api/pa/oauth/linkedin-callback?code=...&state=...
// Exchanges the authorization code for an access token + member URN.

const { admin } = require('../../../lib/pa/supabase');
const { encrypt, decrypt } = require('../../../lib/pa/crypto');
const { fetchMemberUrn } = require('../../../lib/pa/linkedin');
const { handler } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  const { code, state, error: oauthError } = req.query || {};
  if (oauthError) { res.status(400).send(`LinkedIn: ${oauthError}`); return; }
  if (!code || !state) { res.status(400).send('Missing code or state'); return; }

  let userId;
  try {
    const { u } = JSON.parse(Buffer.from(state, 'base64url').toString());
    userId = u;
  } catch {
    res.status(400).send('Invalid state'); return;
  }

  const sb = admin();
  const { data: s } = await sb.from('settings').select('*').eq('user_id', userId).maybeSingle();
  if (!s?.linkedin_client_id || !s?.linkedin_client_secret_enc) {
    res.status(400).send('LinkedIn client credentials not saved');
    return;
  }

  const clientId = s.linkedin_client_id;
  const clientSecret = decrypt(s.linkedin_client_secret_enc);
  const redirectUri = new URL('/api/pa/oauth/linkedin-callback', process.env.PA_APP_URL).toString();

  // Token exchange — LinkedIn accepts form-encoded body with client creds inline
  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    res.status(400).send(`LinkedIn token exchange failed: ${text}`);
    return;
  }
  const tok = await tokenRes.json();

  // Fetch member URN so we can author posts
  let memberUrn = null;
  try {
    memberUrn = await fetchMemberUrn(tok.access_token);
  } catch (e) {
    console.warn('[pa] linkedin member URN fetch failed', e.message);
  }

  await sb.from('settings').update({
    linkedin_access_token_enc: encrypt(tok.access_token),
    linkedin_expires_at: new Date(Date.now() + (tok.expires_in || 5184000) * 1000).toISOString(),
    linkedin_member_urn: memberUrn,
  }).eq('user_id', userId);

  res.redirect(`${process.env.PA_APP_URL}?tab=settings&linkedin=connected`);
});
