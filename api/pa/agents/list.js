// GET /api/pa/agents/list
// Returns the user's agent roster. Seeds defaults if empty.

const { requireUser, admin } = require('../../../lib/pa/supabase');
const { handler, allow, ok } = require('../../../lib/pa/http');
const { DEFAULT_AGENTS } = require('./_defaults');

module.exports = handler(async (req, res) => {
  allow('GET', req);
  const { user, sb } = await requireUser(req);

  let { data: agents, error } = await sb.from('agents_config').select('*').eq('user_id', user.id).order('order_index');
  if (error) throw error;

  // Seed defaults on first-ever login
  if (!agents || agents.length === 0) {
    const admin_sb = admin();
    const seed = DEFAULT_AGENTS.map((a) => ({ ...a, user_id: user.id }));
    const { error: insErr } = await admin_sb.from('agents_config').insert(seed);
    if (insErr) throw insErr;
    const again = await sb.from('agents_config').select('*').eq('user_id', user.id).order('order_index');
    agents = again.data || [];
  }

  const { data: settings } = await sb.from('settings').select('uber_goal').eq('user_id', user.id).maybeSingle();
  ok(res, { agents, uber_goal: settings?.uber_goal || '' });
});
