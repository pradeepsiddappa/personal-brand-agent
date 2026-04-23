// GET /api/pa/pipeline/drafts
// Returns recent drafts (last 7 days), newest first — all stages.
// Flow tab uses the in-flight ones; Approval tab shows the messenger-stage ones
// plus recent history.

const { requireUser } = require('../../../lib/pa/supabase');
const { handler, allow, ok } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('GET', req);
  const { user, sb } = await requireUser(req);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('drafts')
    .select('*')
    .eq('user_id', user.id)
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  ok(res, { drafts: data || [] });
});
