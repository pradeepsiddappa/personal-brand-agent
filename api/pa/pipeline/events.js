// GET /api/pa/pipeline/events
// Recent events (for Timeline tab).

const { requireUser } = require('../../../lib/pa/supabase');
const { handler, allow, ok } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('GET', req);
  const { user, sb } = await requireUser(req);
  const { data, error } = await sb
    .from('events')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  ok(res, { events: data || [] });
});
