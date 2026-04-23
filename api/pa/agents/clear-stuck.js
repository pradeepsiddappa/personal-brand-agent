// POST /api/pa/agents/clear-stuck
// Log a synthetic "error" event for an agent so the UI's isRunningOf()
// derivation stops showing it as running. Use when a previous run crashed
// silently (server timeout / unhandled exception).
// Body: { id }

const { requireUser, admin } = require('../../../lib/pa/supabase');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);
  const { id } = req.body || {};
  if (!id) return bad(res, 'id required');

  const sb = admin();
  await sb.from('events').insert({
    user_id: user.id,
    agent: id,
    kind: 'run',
    title: `${id} cleared (manual)`,
    detail: 'Stuck "started" state cleared from the Agents tab',
    tag: 'error',
  });

  ok(res, { ok: true });
});
