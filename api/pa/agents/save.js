// POST /api/pa/agents/save
// Upsert one agent's config. Uses RLS via the user's JWT.

const { requireUser } = require('../../../lib/pa/supabase');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user, sb } = await requireUser(req);
  const a = req.body || {};
  if (!a.id || !a.name || !a.role) return bad(res, 'id, name, role are required');

  const row = {
    user_id: user.id,
    id: a.id,
    name: a.name,
    role: a.role,
    goal: a.goal || null,
    description: a.description || null,
    prompt_template: a.prompt_template || null,
    schedule: a.schedule || 'manual',
    depends_on: a.depends_on || [],
    enabled: a.enabled !== false,
    order_index: a.order_index ?? 0,
    config: a.config || {},
  };

  const { error } = await sb.from('agents_config').upsert(row, { onConflict: 'user_id,id' });
  if (error) return bad(res, error.message);
  ok(res, { saved: true });
});
