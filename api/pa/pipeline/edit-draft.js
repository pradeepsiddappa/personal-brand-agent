// POST /api/pa/pipeline/edit-draft
// Inline-update the text or LinkedIn-text of a pending draft from the
// Approval tab. Lets you fix typos / re-phrase before approving without
// going through Writer again.
// Body: { draft_id, text?, text_linkedin? }

const { requireUser, admin } = require('../../../lib/pa/supabase');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);
  const { draft_id, text, text_linkedin } = req.body || {};
  if (!draft_id) return bad(res, 'draft_id required');

  // Confirm the draft belongs to this user.
  const sb = admin();
  const { data: draft } = await sb.from('drafts').select('id, user_id, text, text_linkedin')
    .eq('id', draft_id).eq('user_id', user.id).maybeSingle();
  if (!draft) return bad(res, 'Draft not found', 404);

  const update = {};
  if (typeof text === 'string')          update.text = text.slice(0, 3000);
  if (typeof text_linkedin === 'string') update.text_linkedin = text_linkedin.slice(0, 3000);
  if (Object.keys(update).length === 0)  return bad(res, 'Nothing to update');

  const { error } = await sb.from('drafts').update(update).eq('id', draft_id);
  if (error) return bad(res, error.message);

  await sb.from('events').insert({
    user_id: user.id, agent: 'human', kind: 'review',
    title: 'Edited ' + draft_id,
    detail: 'Manually edited' + (update.text ? ' text' : '') + (update.text_linkedin ? ' + text_linkedin' : ''),
    tag: 'edited', ref_id: draft_id,
  });

  ok(res, { ok: true });
});
