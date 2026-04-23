// POST /api/pa/pipeline/run-all
// One-click "run the whole pipeline": Scout → Writer → Editor → Messenger.
// Runs sequentially. Publisher is skipped — it only fires after human approval.
//
// The frontend prefers chaining agent-by-agent from the browser (each call
// gets its own timeout budget and the user sees live progress), but this
// endpoint remains for scripted / cron-style invocation.

// Function timeout is configured in vercel.json (maxDuration: 300) since
// this chain can legitimately run 4+ slow Claude calls back to back.

const { requireUser } = require('../../../lib/pa/supabase');
const { runAgent } = require('../../../lib/pa/agent-runner');
const { handler, allow, ok } = require('../../../lib/pa/http');

const CHAIN = ['scout', 'writer', 'editor', 'messenger'];

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);

  const results = [];
  for (const agentId of CHAIN) {
    try {
      const r = await runAgent(user.id, agentId, { force: true });
      results.push({ agent: agentId, ok: true, result: r });
      if (r && r.skipped) break;
    } catch (e) {
      results.push({ agent: agentId, ok: false, error: e.message });
      break;
    }
  }

  ok(res, { ran: results });
});
