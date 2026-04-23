// POST /api/pa/pipeline/regenerate-image
// Re-renders a draft's image using the current inferImageSpec logic,
// based on the draft's existing text. Use when an older draft was stored
// with a half-empty spec (e.g. milestone with no title) and you want a
// properly populated card before publishing.
// Body: { draft_id }

const { requireUser, admin } = require('../../../lib/pa/supabase');
const { inferImageSpec } = require('../../../lib/pa/agent-runner');
const { renderSvg } = require('../../../lib/pa/image');
const { handler, allow, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  allow('POST', req);
  const { user } = await requireUser(req);
  const { draft_id } = req.body || {};
  if (!draft_id) return bad(res, 'draft_id required');

  const sb = admin();
  const { data: draft } = await sb.from('drafts').select('*')
    .eq('id', draft_id).eq('user_id', user.id).maybeSingle();
  if (!draft) return bad(res, 'Draft not found', 404);

  const imageSpec = inferImageSpec({ text: draft.text, category: draft.category });

  // Pull brand accent from settings so the regenerated card matches the user's design system.
  const { data: s } = await sb.from('settings').select('brand_accent_hex, image_font').eq('user_id', user.id).maybeSingle();
  if (s?.brand_accent_hex) imageSpec.brand_accent_hex = s.brand_accent_hex;
  imageSpec.font_family = s?.image_font || 'Inter';

  let imageSvg;
  try {
    imageSvg = renderSvg(imageSpec);
  } catch (e) {
    return bad(res, 'Render failed: ' + e.message);
  }

  await sb.from('drafts').update({ image_svg: imageSvg, image_spec: imageSpec }).eq('id', draft_id);
  await sb.from('events').insert({
    user_id: user.id, agent: 'human', kind: 'review',
    title: 'Image regenerated for ' + draft_id,
    detail: 'Old spec was likely empty; rebuilt from tweet text',
    tag: 'regenerated', ref_id: draft_id,
  });

  ok(res, { ok: true, spec_kind: imageSpec.kind });
});
