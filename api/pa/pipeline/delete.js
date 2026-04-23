// POST /api/pa/pipeline/delete
// Hard-delete a draft. Use when a generated draft is a hallucination
// (e.g. "Ravix" — made-up product name) and you want it out of history
// entirely, not just rejected.
// Body: { draft_id }

const { requireUser, admin } = require('../../../lib/pa/supabase');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);
  const { draft_id } = req.body || {};
  if (!draft_id) return bad(res, 'draft_id required');

  const sb = admin();
  const { error } = await sb.from('drafts').delete()
    .eq('id', draft_id).eq('user_id', user.id);
  if (error) return bad(res, error.message);

  await sb.from('events').insert({
    user_id: user.id, agent: 'human', kind: 'rejected',
    title: 'Deleted ' + draft_id, detail: 'Hard-deleted (likely hallucination)',
    tag: 'deleted', ref_id: draft_id,
  });

  ok(res, { ok: true, deleted: draft_id });
});
