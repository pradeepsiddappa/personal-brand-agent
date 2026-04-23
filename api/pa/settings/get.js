// GET /api/pa/settings/get
// Returns the user's settings with sensitive values masked.

const { requireUser } = require('../../../lib/pa/supabase');
const { decrypt, mask } = require('../../../lib/pa/crypto');
const { handler, allow, ok } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('GET', req);
  const { user, sb } = await requireUser(req);

  const { data } = await sb.from('settings').select('*').eq('user_id', user.id).maybeSingle();

  const out = {
    uber_goal:   data?.uber_goal   || '',
    brand_voice: data?.brand_voice || '',
    website_url: data?.website_url || '',
    promotions:  data?.promotions  || '',
    brand_accent_hex: data?.brand_accent_hex || '',
    design_language:  data?.design_language  || '',
    reference_links:  data?.reference_links  || '',
    tweet_templates:  data?.tweet_templates  || '',
    image_font:       data?.image_font       || 'Inter',
    claude:   maskField(data?.claude_key_enc),
    twitter:  data?.twitter_access_token_enc
      ? { masked: `@${data.twitter_handle || 'connected'}`, connected: true }
      : { masked: '', connected: false },
    telegram: data?.telegram_bot_token_enc
      ? { masked: data.telegram_chat_id ? `chat: ${data.telegram_chat_id}` : 'token saved', connected: true }
      : { masked: '', connected: false },
    linkedin: data?.linkedin_access_token_enc
      ? { masked: 'connected', connected: true }
      : { masked: '', connected: false },
    github_repo: data?.github_repo || '',
    github_branch: data?.github_branch || 'main',
    github_token_set: !!data?.github_token_enc,
  };

  ok(res, out);
});

function maskField(encBlob) {
  if (!encBlob) return { masked: '', connected: false };
  try {
    const plain = decrypt(encBlob);
    return { masked: mask(plain), connected: true };
  } catch {
    return { masked: '(corrupt)', connected: false };
  }
}
