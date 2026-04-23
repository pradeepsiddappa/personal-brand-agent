// POST /api/pa/settings/save
// Save API keys (encrypted) and related metadata.
// Partial updates supported — only provided fields are written.
//
// Accepts:
//   uber_goal                       text
//   claude                          string (API key)
//   telegram                        string (bot token)
//   telegram_chat_id                string
//   twitter_client_id               string
//   twitter_client_secret           string (encrypted server-side)
//   linkedin_client_id              string
//   linkedin_client_secret          string (encrypted server-side)

const { requireUser, admin } = require('../../../lib/pa/supabase');
const { encrypt } = require('../../../lib/pa/crypto');
const { setWebhook } = require('../../../lib/pa/telegram');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);
  const body = req.body || {};

  const update = { user_id: user.id };
  if ('uber_goal'    in body) update.uber_goal    = String(body.uber_goal    || '').slice(0, 500);
  if ('brand_voice'  in body) update.brand_voice  = String(body.brand_voice  || '').slice(0, 2000);
  if ('website_url'  in body) update.website_url  = String(body.website_url  || '').slice(0, 200);
  if ('promotions'   in body) update.promotions   = String(body.promotions   || '').slice(0, 1500);
  if ('brand_accent_hex' in body) {
    const hex = String(body.brand_accent_hex || '').trim();
    update.brand_accent_hex = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : null;
  }
  if ('design_language' in body) update.design_language = String(body.design_language || '').slice(0, 800);
  if ('reference_links' in body) update.reference_links = String(body.reference_links || '').slice(0, 2000);
  if ('tweet_templates' in body) update.tweet_templates = String(body.tweet_templates || '').slice(0, 3000);
  if ('image_font' in body) {
    const allowedFonts = ['Inter', 'JetBrains Mono', 'IBM Plex Sans', 'Lora', 'Space Grotesk', 'Noto Sans'];
    const font = String(body.image_font || 'Inter');
    update.image_font = allowedFonts.indexOf(font) !== -1 ? font : 'Inter';
  }

  // Claude
  if (body.claude)   update.claude_key_enc = encrypt(body.claude);

  // Telegram
  if (body.telegram)         update.telegram_bot_token_enc = encrypt(body.telegram);
  if (body.telegram_chat_id) update.telegram_chat_id       = String(body.telegram_chat_id);

  // Twitter OAuth client credentials (not tokens — those come via callback)
  if (body.twitter_client_id)     update.twitter_client_id         = String(body.twitter_client_id);
  if (body.twitter_client_secret) update.twitter_client_secret_enc = encrypt(body.twitter_client_secret);

  // LinkedIn OAuth client credentials
  if (body.linkedin_client_id)     update.linkedin_client_id         = String(body.linkedin_client_id);
  if (body.linkedin_client_secret) update.linkedin_client_secret_enc = encrypt(body.linkedin_client_secret);

  // GitHub PAT for SEO auto-commit
  if (body.github_token)  update.github_token_enc = encrypt(body.github_token);
  if ('github_repo'   in body) update.github_repo   = String(body.github_repo   || '').slice(0, 100);
  if ('github_branch' in body) update.github_branch = String(body.github_branch || 'main').slice(0, 60);

  const sb = admin();
  const { error } = await sb.from('settings').upsert(update, { onConflict: 'user_id' });
  if (error) return bad(res, error.message);

  // If the user just saved a new Telegram token, register the webhook so
  // Approve/Reject/Edit taps in Telegram actually reach us. Failure here
  // shouldn't block the save — we surface the warning to the client.
  let webhookWarning = null;
  if (body.telegram) {
    try {
      const origin = new URL(process.env.PA_APP_URL).origin;
      const webhookUrl = `${origin}/api/pa/webhooks/telegram`;
      await setWebhook(body.telegram, webhookUrl);
    } catch (e) {
      webhookWarning = `Saved, but couldn't register Telegram webhook: ${e.message}`;
    }
  }

  ok(res, { saved: true, warning: webhookWarning });
});
