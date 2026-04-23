// ─────────────────────────────────────────────────────────
// claude.js — thin wrapper around the Anthropic SDK
// Each user brings their own API key, stored encrypted.
// ─────────────────────────────────────────────────────────

const Anthropic = require('@anthropic-ai/sdk');

function forKey(apiKey) {
  if (!apiKey) throw new Error('No Claude API key configured');
  return new Anthropic({ apiKey });
}

/**
 * Call Claude with a simple text completion.
 * @param {string} apiKey — user's own key (plaintext — decrypted at call time)
 * @param {object} opts   — { model, system, user, maxTokens }
 */
async function complete(apiKey, { model = 'claude-sonnet-4-5', system, user, maxTokens = 1024 }) {
  const client = forKey(apiKey);
  const res = await client.messages.create({
    model,
    system,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: user }],
  });
  const text = res.content.map((b) => b.type === 'text' ? b.text : '').join('');
  return { text, raw: res };
}

module.exports = { complete };
