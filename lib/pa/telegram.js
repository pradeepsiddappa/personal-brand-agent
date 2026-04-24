// ─────────────────────────────────────────────────────────
// telegram.js — raw Telegram Bot API helpers
// ─────────────────────────────────────────────────────────

const { admin } = require('./supabase');
const { decrypt } = require('./crypto');

async function getConfig(userId) {
  const sb = admin();
  const { data, error } = await sb.from('settings').select('telegram_bot_token_enc, telegram_chat_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data?.telegram_bot_token_enc) throw new Error('Telegram not configured');
  return {
    token: decrypt(data.telegram_bot_token_enc),
    chatId: data.telegram_chat_id,
  };
}

async function callApi(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API: ${data.description}`);
  return data.result;
}

// Multipart upload helper — sendPhoto needs an InputFile (form-data).
// Native FormData + Blob work on Node 22 (Vercel default).
async function uploadPhoto(token, { chat_id, photo, caption, parse_mode, reply_markup, filename }) {
  const form = new FormData();
  form.append('chat_id', String(chat_id));
  if (caption)      form.append('caption', caption);
  if (parse_mode)   form.append('parse_mode', parse_mode);
  if (reply_markup) form.append('reply_markup', JSON.stringify(reply_markup));
  form.append('photo', new Blob([photo], { type: 'image/png' }), filename || 'draft.png');

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram sendPhoto: ${data.description}`);
  return data.result;
}

// editMessageMedia equivalent of uploadPhoto — swaps the image of an
// existing message in place via multipart upload. The `media` field is
// a JSON object that references an attached file via `attach://photo`,
// per the Telegram bot API spec.
async function editPhotoMedia(token, { chat_id, message_id, photo, caption, parse_mode, reply_markup, filename }) {
  const form = new FormData();
  form.append('chat_id', String(chat_id));
  form.append('message_id', String(message_id));
  const mediaSpec = { type: 'photo', media: 'attach://photo' };
  if (caption)    mediaSpec.caption = caption;
  if (parse_mode) mediaSpec.parse_mode = parse_mode;
  form.append('media', JSON.stringify(mediaSpec));
  if (reply_markup) form.append('reply_markup', JSON.stringify(reply_markup));
  form.append('photo', new Blob([photo], { type: 'image/png' }), filename || 'draft.png');

  const res = await fetch(`https://api.telegram.org/bot${token}/editMessageMedia`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram editMessageMedia: ${data.description}`);
  return data.result;
}

// Build the inline_keyboard shown under a draft card. For poster drafts
// we prepend a style-picker row so the user can cycle through poster
// variants without leaving Telegram. The active variant is marked with
// a leading "●" so the choice is visible at a glance.
//
// Kept here (not in sendDraftCard) so the style callback handler can
// reuse the exact same keyboard shape when it edits the message after
// the user picks a style.
function buildDraftKeyboard(draft) {
  const rows = [];
  const isPoster = draft && draft.image_spec && draft.image_spec.kind === 'poster';
  if (isPoster) {
    const { POSTER_VARIANTS } = require('./image');
    const current = draft.image_spec.variant || 'classic';
    const cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
    const styleBtn = function (v) {
      return {
        text: (v === current ? '● ' : '') + cap(v),
        callback_data: 'style_' + v + ':' + draft.id,
      };
    };
    // Telegram inline keyboards render rows side-by-side; with 5 short
    // labels we split 3+2 so each button stays tappable on mobile.
    rows.push(POSTER_VARIANTS.slice(0, 3).map(styleBtn));
    rows.push(POSTER_VARIANTS.slice(3).map(styleBtn));
  }
  // Decision buttons — same for every draft, regardless of kind.
  rows.push([
    { text: '✓ Post to both',     callback_data: 'both:' + draft.id },
    { text: '🐦 Post on X',        callback_data: 'twitter:' + draft.id },
  ]);
  rows.push([
    { text: '💼 Post on LinkedIn', callback_data: 'linkedin:' + draft.id },
    { text: '✕ Reject',            callback_data: 'reject:' + draft.id },
  ]);
  // Text-only-X row: posts to twitter only, no image attached. Useful
  // when the auto-rendered image doesn't fit the moment but the copy is
  // good. LinkedIn intentionally not offered as text-only — image-on
  // LinkedIn drives more engagement.
  rows.push([
    { text: '📝 X (text only)',    callback_data: 'text_x:' + draft.id },
  ]);
  return { inline_keyboard: rows };
}

/**
 * Send a draft card with approve/reject/edit inline buttons.
 * Uses sendPhoto when the draft has an image (caption limit 1024 chars)
 * so users see the card preview in chat; falls back to sendMessage
 * for threads, longposts, or missing images.
 */
async function sendDraftCard(userId, draft) {
  const { token, chatId } = await getConfig(userId);
  const category = draft.category || 'draft';
  const confidence = draft.confidence || '';
  const confChip = confidence ? ` · conf: ${confidence}` : '';
  const typeChip = draft.draft_type && draft.draft_type !== 'single'
    ? ` · ${draft.draft_type.toUpperCase()}` : '';

  // Body text: threads show all parts; longposts truncate at 900 chars so
  // caption fits within Telegram's 1024-char cap; singles use the full text.
  let body;
  if (draft.draft_type === 'thread' && Array.isArray(draft.thread_parts) && draft.thread_parts.length) {
    body = draft.thread_parts.map(function (p, i) {
      return (i + 1) + '/' + draft.thread_parts.length + ' ' + p;
    }).join('\n\n');
  } else if (draft.draft_type === 'longpost') {
    const full = String(draft.text || '');
    body = full.length > 900 ? full.slice(0, 900) + '…' : full;
  } else {
    body = draft.text || '';
  }

  const lengthNote = draft.draft_type === 'thread'
    ? `${(draft.thread_parts || []).length} posts`
    : `${(draft.text || '').length} / ${draft.draft_type === 'longpost' ? 3000 : 280} chars`;

  const caption = [
    `*${category.toUpperCase()}*${typeChip}${confChip}`,
    '',
    body,
    '',
    `_${lengthNote}_`,
  ].join('\n');

  // Keyboard is built by buildDraftKeyboard so the style-picker callback
  // can produce the exact same layout when it edits the message later.
  const reply_markup = buildDraftKeyboard(draft);

  // Decide whether to send as photo or plain message.
  // Photo requires: an SVG available + caption under 1024 chars + single-type.
  const canSendPhoto = draft.image_svg
    && caption.length <= 1020
    && (draft.draft_type === 'single' || !draft.draft_type);

  if (canSendPhoto) {
    try {
      const { svgToPng } = require('./image');
      const png = await svgToPng(draft.image_svg);
      return await uploadPhoto(token, {
        chat_id: chatId,
        photo: png,
        caption,
        parse_mode: 'Markdown',
        reply_markup,
        filename: draft.id + '.png',
      });
    } catch (e) {
      console.warn('[pa] sendDraftCard photo fallback:', e.message);
      // fall through to sendMessage
    }
  }

  return callApi(token, 'sendMessage', {
    chat_id: chatId,
    text: caption,
    parse_mode: 'Markdown',
    reply_markup,
  });
}

async function sendMessage(userId, text) {
  const { token, chatId } = await getConfig(userId);
  return callApi(token, 'sendMessage', { chat_id: chatId, text });
}

/**
 * Send an SEO recommendation card with Apply / Skip buttons.
 * On Apply, the webhook commits the (file, old_content, new_content)
 * edit to the user's GitHub repo.
 */
async function sendSeoCard(userId, rec) {
  const { token, chatId } = await getConfig(userId);
  const priChip  = rec.priority  ? '*[' + String(rec.priority).toUpperCase() + ']* ' : '';
  const fileChip = rec.file_path ? '`' + rec.file_path + '`' : '';
  const diffNote = rec.old_content
    ? '_Diff: ' + rec.old_content.length + ' → ' + (rec.new_content || '').length + ' chars_'
    : '';

  const text = [
    '🔍 *SEO · ' + (rec.kind || 'fix') + '*  ' + fileChip,
    '',
    priChip + (rec.suggestion || ''),
    '',
    diffNote,
  ].filter(Boolean).join('\n');

  const reply_markup = {
    inline_keyboard: [[
      { text: '✓ Apply',  callback_data: `seo_apply:${rec.id}` },
      { text: '✕ Skip',   callback_data: `seo_skip:${rec.id}`  },
    ]],
  };

  return callApi(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    reply_markup,
  });
}

module.exports = {
  getConfig,
  callApi,
  sendDraftCard,
  sendMessage,
  setWebhook,
  sendSeoCard,
  // Newer helpers for the Telegram style-picker flow:
  buildDraftKeyboard,
  editPhotoMedia,
};

/**
 * Register this bot's webhook with Telegram so callback_query taps
 * (approve/reject/edit buttons) reach our handler. Safe to call on
 * every save — setWebhook is idempotent.
 */
async function setWebhook(token, webhookUrl, secretToken) {
  const payload = {
    url: webhookUrl,
    allowed_updates: ['callback_query', 'message'],
  };
  if (secretToken) payload.secret_token = secretToken;
  return callApi(token, 'setWebhook', payload);
}
