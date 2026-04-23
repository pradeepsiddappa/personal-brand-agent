// Cron: every 15 minutes — run Publisher for every user with it enabled.
// Normally approvals auto-trigger Publisher inline (decide.js + Telegram
// webhook). This is a safety net in case the inline run errored (Claude
// rate limit, Twitter hiccup, token refresh glitch) — the approved draft
// is still at stage='publisher' and will get picked up here.

const { admin } = require('../../../lib/pa/supabase');
const { runAgent } = require('../../../lib/pa/agent-runner');
const { handler, ok } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  const sb = admin();
  // Only run for users who actually have drafts waiting at stage='publisher'.
  const { data: pending } = await sb.from('drafts')
    .select('user_id')
    .eq('stage', 'publisher');
  const userIds = Array.from(new Set((pending || []).map(function (p) { return p.user_id; })));

  const results = [];
  for (const userId of userIds) {
    try { results.push({ user: userId, ok: true, r: await runAgent(userId, 'publisher', { force: true }) }); }
    catch (e) { results.push({ user: userId, ok: false, error: e.message }); }
  }
  ok(res, { ran: results.length, results });
});
