// POST /api/pa/agents/reset
// Reset an agent's config (prompt_template, goal, schedule, depends_on)
// to the built-in default. Use when the shipped default has been updated
// and the user's seeded row is stale.
// Body: { id }

const { requireUser, admin } = require('../../../lib/pa/supabase');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');
const { DEFAULT_AGENTS } = require('./_defaults');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);
  const { id } = req.body || {};
  if (!id) return bad(res, 'id required');

  const defaults = DEFAULT_AGENTS.find(function (a) { return a.id === id; });
  if (!defaults) return bad(res, 'No default for agent: ' + id, 404);

  const sb = admin();
  const { error } = await sb.from('agents_config').update({
    name:            defaults.name,
    role:            defaults.role,
    goal:            defaults.goal,
    description:     defaults.description,
    prompt_template: defaults.prompt_template,
    schedule:        defaults.schedule,
    depends_on:      defaults.depends_on,
  }).eq('user_id', user.id).eq('id', id);

  if (error) return bad(res, error.message);
  ok(res, { ok: true, id });
});
