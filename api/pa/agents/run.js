// POST /api/pa/agents/run
// Manual "Run now" trigger.

const { requireUser } = require('../../../lib/pa/supabase');
const { runAgent } = require('../../../lib/pa/agent-runner');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);
  const { id } = req.body || {};
  if (!id) return bad(res, 'id required');

  const result = await runAgent(user.id, id);
  ok(res, { ok: true, result });
});
