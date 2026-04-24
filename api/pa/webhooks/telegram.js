// POST /api/pa/webhooks/telegram
// Telegram bot callback handler — approve / reject / edit.
//
// Wire this via @BotFather:
//   /setwebhook → https://yourdomain.com/api/pa/webhooks/telegram
//
// SECURITY: Telegram doesn't sign webhooks by default. To prevent
// spoofing, set a secret_token when calling setWebhook and verify
// the X-Telegram-Bot-Api-Secret-Token header here.

const { admin } = require('../../../lib/pa/supabase');
const { decrypt } = require('../../../lib/pa/crypto');
const { callApi, sendDraftCard, buildDraftKeyboard, editPhotoMedia, getConfig } = require('../../../lib/pa/telegram');
const { applyEdit } = require('../../../lib/pa/github');
const { extractUrls } = require('../../../lib/pa/url-reader');
const { renderSvg, svgToPng, POSTER_VARIANTS } = require('../../../lib/pa/image');
const { generateFromSeed, runAgent } = require('../../../lib/pa/agent-runner');
const { handler, ok } = require('../../../lib/pa/http');

// Dismiss the loading spinner on the tapped button + show a toast.
// Returns { ok: true } or { ok: false, error }. Do NOT throw — we still
// want the HTTP response to Telegram to succeed (so it doesn't retry the
// webhook for an hour).
async function ackCallback(token, callbackId, text) {
  try {
    await callApi(token, 'answerCallbackQuery', {
      callback_query_id: callbackId,
      text: text || '',
      show_alert: false,
    });
    return { ok: true };
  } catch (e) {
    console.error('[pa] answerCallbackQuery failed:', e.message, '· callbackId:', callbackId);
    return { ok: false, error: e.message };
  }
}

// Replace the draft card with a resolved version (no buttons, status appended).
// Text messages use editMessageText; photo messages use editMessageCaption —
// we try one, fall back to the other if Telegram rejects it. Always strip
// reply_markup (empty object removes the inline keyboard) so the final state
// is visually distinct from the pending state.
async function finalizeCard(token, chatId, messageId, originalText, statusLine) {
  const combined = `${originalText}\n\n${statusLine}`;
  // Photo caption limit is 1024 — truncate defensively.
  const trimmed = combined.length > 1020 ? combined.slice(0, 1017) + '…' : combined;
  try {
    await callApi(token, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: combined,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [] },
    });
  } catch (e) {
    // "message can't be edited" / "there is no text in the message" → it's a photo.
    // "message is not modified" → the edit would be a no-op; swallow silently.
    if (e.message && e.message.indexOf('message is not modified') !== -1) return;
    try {
      await callApi(token, 'editMessageCaption', {
        chat_id: chatId,
        message_id: messageId,
        caption: trimmed,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [] },
      });
    } catch (e2) {
      if (e2.message && e2.message.indexOf('message is not modified') !== -1) return;
      console.warn('[pa] finalizeCard failed (both edit variants):', e.message, '|', e2.message);
    }
  }
}

// Extract a Twitter/X URL from a message if one is present.
function extractTweetUrl(text) {
  if (!text) return null;
  const m = text.match(/https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/[A-Za-z0-9_]+\/status\/\d+/i);
  return m ? m[0] : null;
}

// Save a user message as a "voice example" for the Writer to learn from.
// Supports: plain text, a Twitter URL (we store the URL + whatever text was
// alongside it), or a forwarded message (Telegram attaches forward_* fields).
// Map a chat_id to its settings row + user_id + bot token.
async function resolveChat(chatId) {
  if (!chatId) return null;
  const sb = admin();
  const { data: s } = await sb.from('settings')
    .select('user_id, telegram_bot_token_enc')
    .eq('telegram_chat_id', String(chatId))
    .maybeSingle();
  if (!s?.user_id) return null;
  let token = null;
  try { token = decrypt(s.telegram_bot_token_enc); } catch {}
  return { userId: s.user_id, token };
}

async function reply(token, chatId, text, replyMarkup) {
  if (!token || !chatId) { console.warn('[pa] reply skipped — no token or chatId'); return; }
  const payload = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  try {
    await callApi(token, 'sendMessage', payload);
  } catch (e) {
    console.warn('[pa] reply sendMessage failed:', e.message, '· textLen:', text.length);
    // If Markdown formatting made Telegram reject the message, try again as plain text.
    if (e.message && e.message.indexOf('parse entities') !== -1) {
      try {
        await callApi(token, 'sendMessage', { chat_id: chatId, text });
      } catch (e2) { console.warn('[pa] reply plain-text retry failed:', e2.message); }
    }
  }
}

// Save a piece of text as a voice_example. Returns the row id (for button callbacks).
async function saveAsVoice(userId, rawText, extra) {
  extra = extra || {};
  const sb = admin();
  const tweetUrl = extractTweetUrl(rawText);
  const clean = (tweetUrl ? rawText.replace(tweetUrl, '').trim() : rawText).trim();
  const { data, error } = await sb.from('voice_examples').insert({
    user_id: userId,
    text: clean || tweetUrl || rawText,
    source: extra.source || (tweetUrl ? 'url' : 'manual'),
    source_url: tweetUrl || null,
    note: extra.note || null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

// Trigger generate-from-seed and push the resulting draft card into
// the Telegram chat (with image, approve/reject buttons, platform split).
async function doGenerate(userId, token, chatId, seed, format) {
  await reply(token, chatId, '🖋 Drafting a *' + format + '*…');
  try {
    const urls = extractUrls(seed || '');
    const draft = await generateFromSeed(userId, { seed_text: seed, urls, format });
    // Re-fetch the full draft row so we have image_svg + thread_parts for
    // the Telegram card. generateFromSeed returned a summary, not the full row.
    const sb = admin();
    const { data: full } = await sb.from('drafts').select('*').eq('id', draft.id).maybeSingle();
    if (full) {
      try {
        await sendDraftCard(userId, full);
      } catch (e) {
        await reply(token, chatId,
          '✓ Drafted *' + draft.id + '* (card failed to render: ' + e.message.slice(0, 120) + ').\n' +
          'Open the dashboard Approval tab to review + post.');
      }
    }
  } catch (e) {
    await reply(token, chatId, '⚠️ Generate failed: ' + e.message.slice(0, 200));
  }
}

// Parse a PREFIX: remainder pattern. Case-insensitive, colon required.
function parsePrefix(text) {
  const m = String(text || '').match(/^\s*([A-Za-z]+)\s*:\s*([\s\S]+)?$/);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), body: (m[2] || '').trim() };
}

// Route a non-callback message through the ambient-capture logic.
// Supports explicit prefixes (TWEET:, THREAD:, BLOG:, SYNTH:, IDEA:, PROMOTE:, DRAFT:)
// and an implicit flow (plain text → save to voice library + offer a menu).
async function handleIncomingText(msg, chatId) {
  const resolved = await resolveChat(chatId);
  if (!resolved) return { ok: false, reason: 'no-user-for-chat' };
  const { userId, token } = resolved;

  const rawText = msg.text || msg.caption || '';
  const parsed = parsePrefix(rawText);
  const urls = extractUrls(rawText);

  // Explicit prefix routing
  if (parsed) {
    const body = parsed.body || '';
    switch (parsed.prefix) {
      case 'TWEET':
      case 'POST':
        await doGenerate(userId, token, chatId, body, 'tweet');
        return { ok: true, routed: 'tweet' };
      case 'THREAD':
        await doGenerate(userId, token, chatId, body, 'thread');
        return { ok: true, routed: 'thread' };
      case 'BLOG':
      case 'LINKEDIN':
        await doGenerate(userId, token, chatId, body, 'longpost');
        return { ok: true, routed: 'longpost' };
      case 'SYNTH': {
        const bodyUrls = extractUrls(body);
        if (bodyUrls.length === 0) {
          await reply(token, chatId, '⚠️ SYNTH: needs at least one URL in the message.');
          return { ok: false };
        }
        const fmt = bodyUrls.length > 1 ? 'thread' : 'tweet';
        await doGenerate(userId, token, chatId, body, fmt);
        return { ok: true, routed: 'synth-' + fmt };
      }
      case 'QUOTE':
        await doGenerate(userId, token, chatId, body, 'quote-tweet');
        return { ok: true, routed: 'quote-tweet' };
      case 'IDEA': {
        // Park in signals so Writer picks it up on the next run.
        const sb = admin();
        await sb.from('signals').insert({
          user_id: userId, source: 'idea', author: 'user',
          url: null, excerpt: body.slice(0, 500), topics: ['idea'],
        });
        await reply(token, chatId, '💡 Idea parked. Next Writer run will see it.');
        return { ok: true, routed: 'idea' };
      }
      case 'PROMOTE': {
        const sb = admin();
        const { data: current } = await sb.from('settings').select('promotions').eq('user_id', userId).maybeSingle();
        const prev = (current && current.promotions) || '';
        const appended = (prev ? prev.trim() + '\n' : '') + '• ' + body;
        await sb.from('settings').update({ promotions: appended.slice(0, 1500) }).eq('user_id', userId);
        await reply(token, chatId, '📣 Added to Active Promotions. Writer will include a poster for this next run.');
        return { ok: true, routed: 'promote' };
      }
      case 'DRAFT':
        // Generate without saving to voice_examples (prevents echo training).
        await doGenerate(userId, token, chatId, body, 'tweet');
        return { ok: true, routed: 'draft-only' };
    }
    // Unknown prefix — fall through to implicit flow using the full message.
  }

  // URL-heavy implicit synthesis: if the user sent 2+ URLs, go straight to synth.
  if (urls.length >= 2) {
    await doGenerate(userId, token, chatId, rawText, 'thread');
    return { ok: true, routed: 'auto-synth' };
  }

  // Implicit flow: save as voice example, then offer a format menu.
  let voiceId = null;
  try {
    voiceId = await saveAsVoice(userId, rawText, {
      source: msg.forward_from ? 'telegram-fwd' : 'manual',
      note: msg.forward_from?.username ? 'Forwarded from @' + msg.forward_from.username : null,
    });
  } catch (e) {
    await reply(token, chatId,
      '⚠️ Couldn\'t save: ' + e.message.slice(0, 160) +
      '\n\nIf voice_examples does not exist, run the migration SQL from the dashboard.');
    return { ok: false, error: e.message };
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✍️ Post',      callback_data: 'cap_tweet:' + voiceId },
        { text: '🧵 Thread',    callback_data: 'cap_thread:' + voiceId },
      ],
      [
        { text: '📝 LinkedIn',  callback_data: 'cap_long:' + voiceId },
        { text: '💾 Save only', callback_data: 'cap_skip:' + voiceId },
      ],
    ],
  };
  await reply(token, chatId,
    '✓ Saved to voice library.\n*Turn this into content?*',
    keyboard);
  return { ok: true, routed: 'menu-offered', voice_id: voiceId };
}

// Handle a tap on one of the cap_* inline keyboard buttons.
async function handleCaptureCallback(cb, action, voiceId, res) {
  const t0 = Date.now();
  console.log('[pa] ' + action + ' START voiceId=' + voiceId);
  const sb = admin();
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const originalText = cb.message?.text || '';
  const resolved = await resolveChat(chatId);
  if (!resolved) return ok(res, { not_found: 'chat' });
  const { userId, token } = resolved;
  console.log('[pa] cap resolved chat in', Date.now() - t0, 'ms, user:', userId);

  if (action === 'cap_skip') {
    if (token) {
      await ackCallback(token, cb.id, 'Saved only');
      if (chatId && messageId) await finalizeCard(token, chatId, messageId, originalText, '💾 *Saved to voice library.*');
    }
    return ok(res, { handled: true, action });
  }

  const { data: v } = await sb.from('voice_examples').select('text, source_url').eq('id', voiceId).maybeSingle();
  if (!v) {
    if (token) await ackCallback(token, cb.id, 'Original message not found');
    return ok(res, { not_found: 'voice' });
  }

  const formatMap = { 'cap_tweet': 'tweet', 'cap_thread': 'thread', 'cap_long': 'longpost' };
  const format = formatMap[action] || 'tweet';
  const seed = v.text + (v.source_url ? ' ' + v.source_url : '');

  // Ack fast so the spinner dismisses — the actual generate happens after.
  if (token) await ackCallback(token, cb.id, 'Drafting ' + format + '…');
  if (chatId && messageId) {
    await finalizeCard(token, chatId, messageId, originalText, '🖋 *Drafting a ' + format + '*…');
  }
  console.log('[pa] cap ack + finalize done in', Date.now() - t0, 'ms');

  try {
    console.log('[pa] cap calling generateFromSeed format=' + format + ' seedLen=' + (v.text || '').length);
    const draft = await generateFromSeed(userId, {
      seed_text: v.text,
      urls: v.source_url ? [v.source_url] : extractUrls(v.text),
      format,
    });
    console.log('[pa] cap generateFromSeed DONE in', Date.now() - t0, 'ms · draftId:', draft.id);

    // Re-fetch the full draft row so we can render the photo card.
    console.log('[pa] cap fetching full draft row for', draft.id);
    const { data: full, error: fetchErr } = await sb.from('drafts').select('*').eq('id', draft.id).maybeSingle();
    console.log('[pa] cap draft fetch done in', Date.now() - t0, 'ms · found:', !!full, '· err:', fetchErr?.message || 'none');

    if (!full) {
      // Belt-and-braces: the draft exists (we just inserted it) but the
      // re-fetch returned nothing. Don't leave the user wondering — ping
      // them in Telegram with the id and point at the dashboard.
      await reply(token, chatId,
        '✓ Drafted *' + draft.id + '*.\n' +
        '(Couldn\'t re-fetch the full row to render the card preview here — open the dashboard Approval tab to review + post.)');
      return ok(res, { handled: true, action, draft_id: draft.id, note: 'refetch-empty' });
    }

    try {
      console.log('[pa] cap sendDraftCard START');
      await sendDraftCard(userId, full);
      console.log('[pa] cap sendDraftCard DONE in', Date.now() - t0, 'ms');
    } catch (e) {
      console.warn('[pa] cap sendDraftCard failed:', e.message);
      // Fall back to a plain-text message with the draft text + buttons so
      // the user can still action it without opening the dashboard.
      const fallback = [
        '✓ Drafted *' + draft.id + '* (photo failed: ' + e.message.slice(0, 100) + ')',
        '',
        (full.text || '').slice(0, 800),
      ].join('\n');
      const reply_markup = {
        inline_keyboard: [
          [ { text: '✓ Post to both',  callback_data: 'both:'  + draft.id },
            { text: '🐦 Post on X',     callback_data: 'twitter:' + draft.id } ],
          [ { text: '💼 Post on LinkedIn', callback_data: 'linkedin:' + draft.id },
            { text: '✕ Reject',         callback_data: 'reject:'   + draft.id } ],
        ],
      };
      await reply(token, chatId, fallback, reply_markup);
    }
    return ok(res, { handled: true, action, draft_id: draft.id, ms: Date.now() - t0 });
  } catch (e) {
    console.error('[pa] cap generate FAILED in', Date.now() - t0, 'ms:', e.message);
    await reply(token, chatId,
      '⚠️ Generate failed: ' + e.message.slice(0, 300) +
      '\n\n(Check Vercel function logs for the raw Claude response.)');
    return ok(res, { handled: false, error: e.message, ms: Date.now() - t0 });
  }
}

// Resolve the user's bot token by chat_id (set when Telegram was connected).
async function tokenForChat(sb, chatId) {
  if (!chatId) return null;
  const { data: s } = await sb.from('settings')
    .select('telegram_bot_token_enc')
    .eq('telegram_chat_id', String(chatId))
    .maybeSingle();
  if (!s?.telegram_bot_token_enc) return null;
  try { return decrypt(s.telegram_bot_token_enc); } catch { return null; }
}

// Poster style picker — re-renders the draft's image with the selected
// variant and swaps the photo on the existing Telegram message. Decision
// buttons stay so the user can post immediately after picking a design.
//
// callback_data: `style_<variant>:<draft_id>` (e.g. style_studio:p-abc1)
async function handleStyleCallback(cb, action, draftId, res) {
  const variant = action.replace(/^style_/, '');
  const sb = admin();

  // Look up the draft + the user's bot token (needed to ack + edit message).
  // Use the same getConfig() helper the rest of the codebase uses so we
  // read the correct column (telegram_bot_token_enc, not *_token_enc).
  const { data: draft } = await sb.from('drafts').select('*').eq('id', draftId).maybeSingle();
  let token = null;
  let chatId = null;
  let messageId = null;
  if (cb.message) {
    // Trust the chat_id from the callback over settings.telegram_chat_id —
    // the user tapped FROM this chat, so it's authoritative.
    chatId = cb.message.chat && cb.message.chat.id;
    messageId = cb.message.message_id;
  }
  if (draft && draft.user_id) {
    try {
      const cfg = await getConfig(draft.user_id);
      token = cfg.token;
      // Fall back to settings.telegram_chat_id only if the callback didn't have one.
      if (!chatId) chatId = cfg.chatId;
    } catch (e) {
      // Telegram not configured — leave token null and return quietly below.
      console.warn('[pa] style callback: getConfig failed:', e.message);
    }
  }

  if (!draft) {
    if (token) await ackCallback(token, cb.id, 'Draft not found');
    return ok(res, { ignored: 'draft not found', draftId });
  }
  if (!POSTER_VARIANTS.includes(variant)) {
    if (token) await ackCallback(token, cb.id, 'Unknown style: ' + variant);
    return ok(res, { ignored: 'unknown variant', variant });
  }
  if (!draft.image_spec || draft.image_spec.kind !== 'poster') {
    if (token) await ackCallback(token, cb.id, 'Style picker is poster-only');
    return ok(res, { ignored: 'not a poster', kind: draft.image_spec && draft.image_spec.kind });
  }

  // Re-render with the new variant. Apply user's brand accent + font as
  // regenerate-image.js does so the swapped image stays on-brand.
  const newSpec = Object.assign({}, draft.image_spec, { variant: variant });
  const { data: brand } = await sb.from('settings')
    .select('brand_accent_hex, image_font')
    .eq('user_id', draft.user_id)
    .maybeSingle();
  if (brand && brand.brand_accent_hex) newSpec.brand_accent_hex = brand.brand_accent_hex;
  newSpec.font_family = (brand && brand.image_font) || 'Inter';

  let newSvg;
  try {
    newSvg = renderSvg(newSpec);
  } catch (e) {
    if (token) await ackCallback(token, cb.id, 'Render failed: ' + e.message.slice(0, 60));
    return ok(res, { error: 'render', message: e.message });
  }

  await sb.from('drafts').update({ image_svg: newSvg, image_spec: newSpec }).eq('id', draftId);
  await sb.from('events').insert({
    user_id: draft.user_id, agent: 'human', kind: 'review',
    title: 'Style → ' + variant + ' for ' + draftId,
    detail: 'Picked from Telegram',
    tag: 'style', ref_id: draftId,
  });

  // Build the keyboard with the new active indicator + swap the image.
  const updatedDraft = Object.assign({}, draft, { image_svg: newSvg, image_spec: newSpec });
  const reply_markup = buildDraftKeyboard(updatedDraft);

  if (token && chatId && messageId) {
    try {
      const png = await svgToPng(newSvg);
      await editPhotoMedia(token, {
        chat_id: chatId,
        message_id: messageId,
        photo: png,
        // Telegram editMessageMedia REQUIRES the caption again — passing
        // none would clear it. We re-attach the original caption & markup.
        caption: cb.message.caption || cb.message.text || '',
        parse_mode: 'Markdown',
        reply_markup,
        filename: draftId + '.png',
      });
      await ackCallback(token, cb.id, 'Style → ' + variant);
    } catch (e) {
      console.warn('[pa] style editMessageMedia failed:', e.message);
      // Last-ditch ack so the spinner clears even if the swap failed.
      try { await ackCallback(token, cb.id, 'Style saved (refresh)'); } catch (_) {}
    }
  }

  return ok(res, { handled: true, action: 'style', variant: variant, draft_id: draftId });
}

// SEO callback router. On Apply, we look up the recommendation, fetch
// the file from GitHub via the user's PAT, replace old→new, and commit.
// Updates the rec row + edits the original Telegram card to show outcome.
async function handleSeoCallback(cb, action, recId, res) {
  const sb = admin();
  const { data: rec } = await sb.from('seo_recommendations').select('*').eq('id', recId).maybeSingle();
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const originalText = cb.message?.text || '';
  const token = await tokenForChat(sb, chatId);

  if (!rec) {
    if (token) await ackCallback(token, cb.id, 'Recommendation not found');
    return ok(res, { not_found: true });
  }

  if (rec.status !== 'pending') {
    if (token) await ackCallback(token, cb.id, 'Already ' + rec.status);
    return ok(res, { ignored: 'already-decided', status: rec.status });
  }

  if (action === 'seo_skip') {
    await sb.from('seo_recommendations').update({
      status: 'skipped',
      decided_at: new Date().toISOString(),
    }).eq('id', recId);
    await sb.from('events').insert({
      user_id: rec.user_id, agent: 'human', kind: 'rejected',
      title: 'SEO skipped · ' + (rec.kind || 'fix'),
      detail: rec.suggestion?.slice(0, 200),
      tag: 'seo-skip', ref_id: recId,
    });
    if (token) {
      await ackCallback(token, cb.id, 'Skipped');
      if (chatId && messageId) await finalizeCard(token, chatId, messageId, originalText, '✕ *Skipped*');
    }
    return ok(res, { handled: true, action: 'seo_skip' });
  }

  // Apply path — commit to GitHub and update rec.
  let commitSha = null;
  let errMsg = null;
  try {
    if (!rec.file_path || !rec.old_content || !rec.new_content) {
      throw new Error('Recommendation missing file/old/new content');
    }
    commitSha = await applyEdit(rec.user_id, {
      file: rec.file_path,
      oldContent: rec.old_content,
      newContent: rec.new_content,
      commitMessage: 'SEO: ' + (rec.kind || 'fix') + ' on ' + rec.file_path + '\n\nApproved via Telegram. Recommendation: ' +
        (rec.suggestion || '').slice(0, 200),
    });
  } catch (e) {
    errMsg = e.message;
  }

  if (commitSha) {
    await sb.from('seo_recommendations').update({
      status: 'applied', decided_at: new Date().toISOString(), commit_sha: commitSha,
    }).eq('id', recId);
    await sb.from('events').insert({
      user_id: rec.user_id, agent: 'human', kind: 'approved',
      title: 'SEO applied · ' + (rec.kind || 'fix'),
      detail: 'Commit ' + commitSha.slice(0, 8) + ' · ' + (rec.suggestion || '').slice(0, 160),
      tag: 'seo-apply', ref_id: recId,
    });
    if (token) {
      await ackCallback(token, cb.id, 'Applied · ' + commitSha.slice(0, 7));
      if (chatId && messageId) {
        await finalizeCard(token, chatId, messageId, originalText,
          '✓ *Applied* · commit `' + commitSha.slice(0, 8) + '`');
      }
    }
    return ok(res, { handled: true, action: 'seo_apply', commit: commitSha });
  } else {
    await sb.from('seo_recommendations').update({
      status: 'failed', decided_at: new Date().toISOString(), error: errMsg,
    }).eq('id', recId);
    await sb.from('events').insert({
      user_id: rec.user_id, agent: 'human', kind: 'rejected',
      title: 'SEO apply failed · ' + (rec.kind || 'fix'),
      detail: errMsg?.slice(0, 300),
      tag: 'seo-fail', ref_id: recId,
    });
    if (token) {
      await ackCallback(token, cb.id, 'Failed: ' + (errMsg || 'unknown').slice(0, 60));
      if (chatId && messageId) {
        await finalizeCard(token, chatId, messageId, originalText,
          '⚠ *Apply failed*\n' + (errMsg || 'unknown error').slice(0, 200));
      }
    }
    return ok(res, { handled: false, error: errMsg });
  }
}

module.exports = handler(async (req, res) => {
  // GET → simple health check so users can verify the webhook URL in a browser.
  if (req.method === 'GET') return ok(res, { ok: true, endpoint: 'telegram-webhook' });
  if (req.method !== 'POST') return ok(res, { ignored: true });

  const update = req.body || {};
  console.log('[pa] telegram webhook hit:', JSON.stringify(update).slice(0, 400));

  // Non-callback messages → route through ambient capture.
  if (update.message && (update.message.text || update.message.caption)) {
    const msg = update.message;
    // Ignore slash commands like /start for now.
    if (msg.text && msg.text.startsWith('/')) return ok(res, { ignored: 'slash-command' });
    const chatId = msg.chat?.id;
    const routed = await handleIncomingText(msg, chatId);
    return ok(res, { routed });
  }

  const cb = update.callback_query;
  if (!cb) return ok(res, { ignored: 'not a callback_query' });

  const [action, refId] = (cb.data || '').split(':');
  if (!action || !refId) return ok(res, { ignored: 'bad callback_data', data: cb.data });

  const sb = admin();

  // ── Route: ambient-capture menu (cap_tweet / cap_thread / cap_long / cap_skip)
  if (action.indexOf('cap_') === 0) {
    return await handleCaptureCallback(cb, action, refId, res);
  }

  // ── Route: SEO Apply / Skip ─────────────────────────────────
  if (action === 'seo_apply' || action === 'seo_skip') {
    return await handleSeoCallback(cb, action, refId, res);
  }

  // ── Route: poster style picker (style_classic / _editorial / _split / _gradient / _studio)
  // Re-renders the draft's image with the chosen variant and swaps the
  // photo on the existing Telegram message in place. The post-decision
  // buttons stay in the keyboard so the user can approve right after.
  if (action.indexOf('style_') === 0) {
    return await handleStyleCallback(cb, action, refId, res);
  }

  // ── Route: draft Approve / Reject / Edit (default below) ────
  const draftId = refId;
  const { data: draft } = await sb.from('drafts').select('*').eq('id', draftId).maybeSingle();

  // We need the user's bot token to acknowledge the tap on Telegram's side.
  // Without it Telegram will keep spinning until its 60s timeout.
  const userId = draft?.user_id || null;
  let token = null;
  if (userId) {
    const { data: s } = await sb.from('settings')
      .select('telegram_bot_token_enc')
      .eq('user_id', userId)
      .maybeSingle();
    if (s?.telegram_bot_token_enc) {
      try { token = decrypt(s.telegram_bot_token_enc); } catch { /* ignore */ }
    }
  }

  if (!draft) {
    if (token) await ackCallback(token, cb.id, 'Draft not found');
    return ok(res, { not_found: true });
  }

  const originalText = cb.message?.text || '';
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;

  let statusLine = '';
  let ackText = '';

  // Approve-with-platform buttons on the new Telegram card.
  // Each entry carries: platforms[] + skipImage flag. text_x is the
  // text-only-to-X path: post to twitter only, no image attached.
  const approveActions = {
    approve:  { platforms: ['twitter', 'linkedin'], skipImage: false },
    both:     { platforms: ['twitter', 'linkedin'], skipImage: false },
    twitter:  { platforms: ['twitter'],             skipImage: false },
    linkedin: { platforms: ['linkedin'],            skipImage: false },
    text_x:   { platforms: ['twitter'],             skipImage: true  },
  };

  if (approveActions[action]) {
    const { platforms: pf, skipImage } = approveActions[action];
    const update = { stage: 'publisher', platforms: pf };
    // Clear image_svg so runPublisher's `if (d.image_svg)` guard skips
    // PNG render + media upload. image_spec stays on the draft.
    if (skipImage) update.image_svg = null;
    await sb.from('drafts').update(update).eq('id', draftId);
    const tag = skipImage ? ' (text only)' : '';
    await sb.from('events').insert({
      user_id: draft.user_id, agent: 'human', kind: 'approved',
      title: `Approved ${draftId} (${pf.join('+')}${tag})`,
      detail: draft.text?.slice(0, 100), tag: 'approved', ref_id: draftId,
    });
    statusLine = '✓ *Approved* → posting to ' + pf.join(' + ') + tag + '…';
    ackText = 'Publishing to ' + pf.join('+') + tag + '…';
    // Mark for publishing after we ack. The publish itself runs below
    // the ack so Telegram's spinner dismisses first.
    var pendingPublishFor = draft.user_id;
    var pendingPublishPlatforms = pf;
  } else if (action === 'reject') {
    await sb.from('drafts').update({ stage: 'rejected' }).eq('id', draftId);
    await sb.from('events').insert({
      user_id: draft.user_id, agent: 'human', kind: 'rejected',
      title: `Rejected ${draftId}`, detail: draft.text?.slice(0, 100), tag: 'rejected', ref_id: draftId,
    });
    statusLine = '✕ *Rejected*';
    ackText = 'Rejected';
  } else if (action === 'edit') {
    ackText = 'Edit flow coming soon';
  }

  let ackResult = null;
  if (token) {
    ackResult = await ackCallback(token, cb.id, ackText);
    if (chatId && messageId && statusLine) {
      await finalizeCard(token, chatId, messageId, originalText, statusLine);
    }
  } else {
    console.error('[pa] webhook: no telegram token for user', userId, '— can\'t ack');
  }

  // If this was an approve, run Publisher now (after the ack) and report
  // back with the resulting post URLs (or errors) as a follow-up message.
  // Running here keeps the function alive on Vercel — serverless won't let
  // an async IIFE continue after the main response is sent.
  if (typeof pendingPublishFor !== 'undefined' && pendingPublishFor) {
    let postingNote;
    try {
      const r = await runAgent(pendingPublishFor, 'publisher', { force: true });
      const first = r && r.results && r.results[0];
      const urls = [];
      if (first && first.twitter && first.twitter.url)   urls.push('🐦 ' + first.twitter.url);
      if (first && first.linkedin && first.linkedin.url) urls.push('💼 ' + first.linkedin.url);
      if (urls.length) {
        postingNote = '✓ Live:\n' + urls.join('\n');
      } else if (first && first.errors && first.errors.length) {
        postingNote = '⚠️ Publisher errors for ' + draftId + ':\n' + first.errors.join('\n');
      } else if (r && r.message) {
        postingNote = '✓ Publisher ran — ' + r.message;
      } else {
        postingNote = '✓ Publisher ran. Check the dashboard for post URLs.';
      }
    } catch (e) {
      postingNote = '⚠️ Publisher failed for ' + draftId + ': ' + String(e.message || e).slice(0, 240);
    }
    try {
      if (token && chatId) await callApi(token, 'sendMessage', { chat_id: chatId, text: postingNote });
    } catch (e) {
      console.warn('[pa] post-publish reply failed:', e.message);
    }
  }

  ok(res, { handled: true, action, draftId, ack: ackResult, had_token: !!token });
});
