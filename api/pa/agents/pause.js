// POST /api/pa/agents/pause
// Pause or resume an agent.
//   { id, hours }  — pause for N hours (hours: 0 resumes)

const { requireUser, admin } = require('../../../lib/pa/supabase');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);
  const { id, hours } = req.body || {};
  if (!id) return bad(res, 'id required');
  const h = Number(hours);
  if (!Number.isFinite(h) || h < 0 || h > 24 * 30) return bad(res, 'hours must be 0–720');

  const sb = admin();
  const pausedUntil = h > 0 ? new Date(Date.now() + h * 3600 * 1000).toISOString() : null;
  const { error } = await sb.from('agents_config')
    .update({ paused_until: pausedUntil })
    .eq('user_id', user.id).eq('id', id);
  if (error) return bad(res, error.message);

  ok(res, { id, paused_until: pausedUntil });
});
