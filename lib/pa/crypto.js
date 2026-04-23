// ─────────────────────────────────────────────────────────
// crypto.js — AES-256-GCM encryption for keys at rest
// ─────────────────────────────────────────────────────────

const crypto = require('crypto');

const KEY_HEX = process.env.PA_ENCRYPTION_KEY;
if (!KEY_HEX) console.warn('[pa] PA_ENCRYPTION_KEY not set — encryption will fail');

const KEY = KEY_HEX ? Buffer.from(KEY_HEX, 'hex') : null;
if (KEY && KEY.length !== 32) {
  console.warn('[pa] PA_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
}

/**
 * Encrypt plaintext → returns a single base64 string that packs
 * [12-byte IV || 16-byte auth tag || ciphertext].
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  if (!KEY) throw new Error('PA_ENCRYPTION_KEY missing');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(blob) {
  if (!blob) return null;
  if (!KEY) throw new Error('PA_ENCRYPTION_KEY missing');
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const dec = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
}

/**
 * Mask a secret for UI display. Shows first 6 and last 4 chars.
 *   maskKey('sk-ant-01234abc') → 'sk-ant-···abc'
 */
function mask(value) {
  if (!value) return '';
  if (value.length <= 12) return '···' + value.slice(-3);
  return value.slice(0, 7) + '···' + value.slice(-4);
}

module.exports = { encrypt, decrypt, mask };
