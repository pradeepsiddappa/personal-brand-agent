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
    ? `${(draft.thread_parts || []).length} tweets`
    : `${(draft.text || '').length} / ${draft.draft_type === 'longpost' ? 3000 : 280} chars`;

  const caption = [
    `*${category.toUpperCase()}*${typeChip}${confChip}`,
    '',
    body,
    '',
    `_${lengthNote}_`,
  ].join('\n');

  const reply_markup = {
    inline_keyboard: [
      [
        { text: '✓ Post to both',  callback_data: `both:${draft.id}` },
        { text: '🐦 Twitter only',  callback_data: `twitter:${draft.id}` },
      ],
      [
        { text: '💼 LinkedIn only', callback_data: `linkedin:${draft.id}` },
        { text: '✕ Reject',         callback_data: `reject:${draft.id}` },
      ],
    ],
  };

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

module.exports = { getConfig, callApi, sendDraftCard, sendMessage, setWebhook, sendSeoCard };

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
