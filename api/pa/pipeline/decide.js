// POST /api/pa/pipeline/decide
// Approve or reject a draft from the dashboard (mirrors Telegram buttons).
// Body: { draft_id, action: 'approve' | 'reject' }

const { requireUser, admin } = require('../../../lib/pa/supabase');
const { runAgent } = require('../../../lib/pa/agent-runner');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);
  const { draft_id, action, platforms } = req.body || {};
  if (!draft_id || !action) return bad(res, 'draft_id and action required');
  if (action !== 'approve' && action !== 'reject') return bad(res, 'action must be approve or reject');

  // Validate platforms — default both when approve is requested without it.
  let pf = null;
  if (action === 'approve') {
    const allowed = ['twitter', 'linkedin'];
    pf = Array.isArray(platforms) && platforms.length
      ? platforms.filter(function (p) { return allowed.indexOf(p) !== -1; })
      : allowed.slice();
    if (pf.length === 0) return bad(res, 'platforms must include at least one of twitter, linkedin');
  }

  const sb = admin();
  const { data: draft } = await sb.from('drafts').select('*')
    .eq('id', draft_id).eq('user_id', user.id).maybeSingle();
  if (!draft) return bad(res, 'Draft not found', 404);

  const nextStage = action === 'approve' ? 'publisher' : 'rejected';
  const update = { stage: nextStage };
  if (pf) update.platforms = pf;
  await sb.from('drafts').update(update).eq('id', draft_id);

  const platformTag = pf ? ' (' + pf.join('+') + ')' : '';
  await sb.from('events').insert({
    user_id: user.id,
    agent: 'human',
    kind: action === 'approve' ? 'approved' : 'rejected',
    title: (action === 'approve' ? 'Approved ' : 'Rejected ') + draft_id + platformTag,
    detail: (draft.text || '').slice(0, 100),
    tag: action === 'approve' ? 'approved' : 'rejected',
    ref_id: draft_id,
  });

  // Auto-run Publisher immediately for approved drafts — otherwise the user
  // stares at a "queued" draft forever wondering if it's ever going to post.
  // Errors during publish don't fail the decide call (the stage is already
  // set to 'publisher' so the safety-net cron can retry).
  let publishResult = null;
  if (action === 'approve') {
    try {
      publishResult = await runAgent(user.id, 'publisher', { force: true });
    } catch (e) {
      publishResult = { error: e.message };
    }
  }

  ok(res, { ok: true, stage: nextStage, platforms: pf, publish: publishResult });
});
