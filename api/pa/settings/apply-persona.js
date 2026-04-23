// POST /api/pa/settings/apply-persona
// Applies a starter persona's suggested values to the user's settings row.
// Overwrites only the fields the persona has non-empty suggestions for;
// leaves everything else (API keys, GitHub config, image_font if user set
// one) untouched unless the persona explicitly specifies it.
//
// Body: { persona_key }          → apply that persona's suggestions
//       { persona_key, overwrite } → if overwrite=false, only fill empty fields
//
// GET returns the list of available personas for the picker UI.

const { requireUser, admin } = require('../../../lib/pa/supabase');
const { listPersonas, getPersona } = require('../../../lib/pa/personas');
const { handler, ok, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  if (req.method === 'GET') {
    return ok(res, { personas: listPersonas() });
  }
  if (req.method !== 'POST') return bad(res, 'Method not allowed', 405);

  const { user } = await requireUser(req);
  const { persona_key, overwrite } = req.body || {};
  if (!persona_key) return bad(res, 'persona_key required');

  const persona = getPersona(persona_key);
  if (!persona) return bad(res, 'Unknown persona: ' + persona_key, 404);

  const sb = admin();
  const { data: current } = await sb.from('settings')
    .select('uber_goal, brand_voice, promotions, reference_links, design_language, brand_accent_hex, image_font')
    .eq('user_id', user.id).maybeSingle();

  // Build the update payload. When overwrite is false, skip any field the
  // user has already filled in (so "merge with existing" doesn't blow away
  // their work).
  const update = { user_id: user.id };
  const mapping = [
    ['suggested_uber_goal',         'uber_goal'],
    ['suggested_brand_voice',       'brand_voice'],
    ['suggested_promotions',        'promotions'],
    ['suggested_reference_links',   'reference_links'],
    ['suggested_design_language',   'design_language'],
    ['suggested_brand_accent_hex',  'brand_accent_hex'],
    ['suggested_image_font',        'image_font'],
  ];
  for (const [srcKey, dstKey] of mapping) {
    const suggested = persona[srcKey];
    if (suggested === undefined || suggested === null) continue;
    // Skip empty suggestions UNLESS explicit overwrite is set.
    if (overwrite !== true && !String(suggested).trim()) continue;
    // Skip overwriting user's existing content when overwrite=false.
    if (overwrite === false && current && current[dstKey]) continue;
    update[dstKey] = suggested;
  }

  const { error } = await sb.from('settings').upsert(update, { onConflict: 'user_id' });
  if (error) return bad(res, error.message);

  await sb.from('events').insert({
    user_id: user.id, agent: 'human', kind: 'review',
    title: 'Applied persona · ' + persona.name,
    detail: 'Seeded brand context from the ' + persona.key + ' starter.',
    tag: 'persona', ref_id: persona_key,
  });

  ok(res, { ok: true, applied: persona.key, name: persona.name });
});
