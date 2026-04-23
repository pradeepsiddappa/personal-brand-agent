// ─────────────────────────────────────────────────────────
// linkedin.js — LinkedIn posting + image upload
// ─────────────────────────────────────────────────────────
// LinkedIn REST API quirks:
//   - Posts go to /rest/posts (LinkedIn-Version header required)
//   - Images: 3-step flow via /rest/images?action=initializeUpload
//     → PUT bytes to uploadUrl → reference returned image URN in post
//   - Tokens currently don't refresh reliably; we just require reconnect
//     when expired (LinkedIn's OAuth is mostly authorization_code only).
// ─────────────────────────────────────────────────────────

const { admin } = require('./supabase');
const { decrypt } = require('./crypto');

const LI_VERSION = '202503';   // LinkedIn API version header
const PROTOCOL  = '2.0.0';

/** Pull the user's LinkedIn token + member URN. */
async function getLinkedInToken(userId) {
  const sb = admin();
  const { data: s, error } = await sb.from('settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!s?.linkedin_access_token_enc) throw new Error('LinkedIn not connected');

  const expires = s.linkedin_expires_at ? new Date(s.linkedin_expires_at) : null;
  if (expires && expires < new Date()) {
    throw new Error('LinkedIn token expired — reconnect in Settings');
  }

  return {
    token: decrypt(s.linkedin_access_token_enc),
    memberUrn: s.linkedin_member_urn,  // e.g. 'urn:li:person:XXXXXX'
  };
}

/** Fetch the authenticated user's URN. Call once after OAuth. */
async function fetchMemberUrn(accessToken) {
  // Use the OpenID Connect userinfo endpoint (available with 'profile' scope)
  const res = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LinkedIn userinfo failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  // `sub` is the member ID; build the URN from it
  return `urn:li:person:${data.sub}`;
}

/**
 * Upload an image to LinkedIn. Returns the image URN
 * (e.g. 'urn:li:image:C4D22AQ...') to reference in a post.
 */
async function uploadLinkedInImage(userId, buffer, mimeType = 'image/png') {
  const { token, memberUrn } = await getLinkedInToken(userId);
  if (!memberUrn) throw new Error('LinkedIn member URN missing — reconnect');

  // Step 1: register upload
  const initRes = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': LI_VERSION,
      'X-Restli-Protocol-Version': PROTOCOL,
    },
    body: JSON.stringify({ initializeUploadRequest: { owner: memberUrn } }),
  });
  if (!initRes.ok) {
    const t = await initRes.text();
    throw new Error(`LinkedIn image init failed: ${initRes.status} ${t}`);
  }
  const init = await initRes.json();
  const uploadUrl = init?.value?.uploadUrl;
  const imageUrn  = init?.value?.image;
  if (!uploadUrl || !imageUrn) {
    throw new Error('LinkedIn image init missing uploadUrl/image URN');
  }

  // Step 2: PUT the bytes
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': mimeType,
    },
    body: buffer,
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    throw new Error(`LinkedIn image upload failed: ${putRes.status} ${t}`);
  }

  return imageUrn;
}

/**
 * Create a LinkedIn post. Optionally attaches one image.
 * Returns the post URN and a public URL.
 */
async function postToLinkedIn(userId, text, imageUrn) {
  const { token, memberUrn } = await getLinkedInToken(userId);
  if (!memberUrn) throw new Error('LinkedIn member URN missing — reconnect');

  const body = {
    author: memberUrn,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };

  if (imageUrn) {
    body.content = {
      media: {
        id: imageUrn,
        altText: 'Branded post image',
      },
    };
  }

  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': LI_VERSION,
      'X-Restli-Protocol-Version': PROTOCOL,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LinkedIn post failed: ${res.status} ${t}`);
  }

  // Post URN is in the x-restli-id response header.
  const postUrn = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id');
  const publicUrl = postUrn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/` : null;
  return { postUrn, url: publicUrl };
}

module.exports = {
  getLinkedInToken,
  fetchMemberUrn,
  uploadLinkedInImage,
  postToLinkedIn,
};
