// Cron: daily 06:00 IST — run the FULL morning chain for every active user.
// Writer → Editor → Messenger, so drafts land on your phone at wake-up
// instead of sitting at stage='writer' waiting for a manual Run Editor.
//
// Publisher is NOT in this chain — it runs every 15 min on its own cron
// and only acts on drafts you've approved.

const { admin } = require('../../../lib/pa/supabase');
const { runAgent } = require('../../../lib/pa/agent-runner');
const { handler, ok } = require('../../../lib/pa/http');

const MORNING_CHAIN = ['writer', 'editor', 'messenger'];

module.exports = handler(async (req, res) => {
  const sb = admin();
  // Find every user who has the Writer agent enabled. They're the set of
  // users whose daily pipeline we run.
  const { data: writers } = await sb
    .from('agents_config')
    .select('user_id')
    .eq('id', 'writer')
    .eq('enabled', true);

  const userIds = Array.from(new Set((writers || []).map(function (w) { return w.user_id; })));
  const results = [];

  for (const userId of userIds) {
    const userResult = { user: userId, chain: [] };
    for (const agentId of MORNING_CHAIN) {
      try {
        const r = await runAgent(userId, agentId, { force: true });
        userResult.chain.push({ agent: agentId, ok: true, r });
        // If the agent skipped (paused, disabled), stop the chain — no
        // point running Editor if Writer was paused.
        if (r && r.skipped) break;
      } catch (e) {
        userResult.chain.push({ agent: agentId, ok: false, error: e.message });
        // Keep going — Editor might still have something to do even if
        // Writer had a transient failure. Messenger definitely does.
      }
    }
    results.push(userResult);
  }
  ok(res, { ran: results.length, results });
});
