// ─────────────────────────────────────────────────────────
// twitter.js — Twitter/X OAuth 2.0 PKCE + posting + media
// Standard OAuth 2.0 PKCE flow for Twitter v2 API.
// ─────────────────────────────────────────────────────────

const { admin } = require('./supabase');
const { decrypt, encrypt } = require('./crypto');

/**
 * Fetch the user's Twitter access token. Auto-refreshes if it
 * expires in less than 5 minutes. Returns a plaintext token.
 */
async function getTwitterToken(userId) {
  const sb = admin();
  const { data: s, error } = await sb.from('settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!s?.twitter_access_token_enc) throw new Error('Twitter not connected');

  const expiresAt = s.twitter_expires_at ? new Date(s.twitter_expires_at) : null;
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);

  if (!expiresAt || expiresAt < fiveMinFromNow) {
    return refreshTwitterToken(userId, s);
  }
  return decrypt(s.twitter_access_token_enc);
}

/**
 * Refresh the access token. X rotates refresh tokens — the
 * new one must be saved.
 */
async function refreshTwitterToken(userId, existing) {
  const clientId = existing.twitter_client_id;
  const clientSecret = decrypt(existing.twitter_client_secret_enc);
  const refreshToken = decrypt(existing.twitter_refresh_token_enc);
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Twitter credentials incomplete — reconnect in Settings');
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twitter refresh failed: ${res.status} ${text}`);
  }
  const data = await res.json();

  const sb = admin();
  await sb.from('settings').update({
    twitter_access_token_enc: encrypt(data.access_token),
    twitter_refresh_token_enc: encrypt(data.refresh_token || refreshToken),
    twitter_expires_at: new Date(Date.now() + (data.expires_in || 7200) * 1000).toISOString(),
  }).eq('user_id', userId);

  return data.access_token;
}

/**
 * Upload a media buffer to Twitter. Returns a media_id string
 * usable in POST /2/tweets.
 *
 * Uses the v2 media endpoint which accepts OAuth 2.0 user tokens
 * (requires the `media.write` scope).
 *
 * @param {string} userId
 * @param {Buffer} buffer    raw bytes (PNG/JPEG/GIF)
 * @param {string} mimeType  e.g. 'image/png'
 * @returns {Promise<string>} media_id
 */
async function uploadTwitterMedia(userId, buffer, mimeType = 'image/png') {
  const token = await getTwitterToken(userId);

  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append('media', blob, 'card.png');
  // Explicit category improves delivery + attach eligibility
  form.append('media_category', 'tweet_image');

  const res = await fetch('https://api.twitter.com/2/media/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twitter media upload failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  // Response shape: { data: { id: '...', media_key: '...' } } on v2
  // OR { media_id_string: '...' } on v1.1 fallback
  const mediaId = data?.data?.id || data?.media_id_string || data?.media_id;
  if (!mediaId) throw new Error(`Twitter media upload: no media_id in response: ${JSON.stringify(data)}`);
  return String(mediaId);
}

/**
 * Post a tweet. Returns { id, text }.
 * @param {string} userId
 * @param {string} text
 * @param {string[]} [mediaIds]
 */
async function postToTwitter(userId, text, mediaIds, replyToId) {
  const token = await getTwitterToken(userId);
  const body = { text };
  if (mediaIds?.length) body.media = { media_ids: mediaIds };
  if (replyToId)        body.reply = { in_reply_to_tweet_id: String(replyToId) };

  const res = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twitter post failed: ${res.status} ${errText}`);
  }
  const data = await res.json();
  return { id: data.data?.id, text: data.data?.text };
}

// Post a thread: first tweet with media (if any), each subsequent tweet
// chained via in_reply_to_tweet_id. Returns the first tweet's id + url.
async function postThreadToTwitter(userId, parts, mediaIds) {
  if (!parts || parts.length === 0) throw new Error('thread parts empty');
  const first = await postToTwitter(userId, parts[0], mediaIds);
  let lastId = first.id;
  for (let i = 1; i < parts.length; i++) {
    const p = await postToTwitter(userId, parts[i], null, lastId);
    lastId = p.id;
  }
  return first; // url is built from this in the caller
}

module.exports = {
  postThreadToTwitter,
  getTwitterToken,
  refreshTwitterToken,
  uploadTwitterMedia,
  postToTwitter,
};
