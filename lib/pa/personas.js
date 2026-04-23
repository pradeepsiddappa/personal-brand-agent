// ─────────────────────────────────────────────────────────
// personas.js — starter persona library
// ─────────────────────────────────────────────────────────
// A persona is a JSON blob of suggested defaults. When a user clicks
// "Apply a starter persona" in Settings → Brand context, the chosen
// persona's suggested_* fields overwrite the user's corresponding
// settings fields (brand_voice, uber_goal, reference_links, promotions,
// tweet_templates).
//
// Personas are GENERIC — no real names, no real projects. They're
// scaffolding the user fills in. Placeholders in curly-brace form like
// {Your Name} / {your company} are literal strings the user replaces.
//
// To add a persona: append to PERSONAS below. To override per-user:
// the user just edits Settings after applying.
// ─────────────────────────────────────────────────────────

const PERSONAS = {
  'designer-founder': {
    key: 'designer-founder',
    name: 'Designer-turned-founder',
    description: 'Designer who started shipping products instead of mockups.',
    suggested_uber_goal: 'Establish yourself as the designer who ships real products — not just pretty prototypes.',
    suggested_brand_voice: [
      '{Your years} years designing products. Started shipping instead of handing off to engineers.',
      'Founder of {your project}. Teaches / mentors {your audience}.',
      '',
      'Voice: direct, builder-first, specific over abstract. Real numbers beat big claims.',
      'Always: short sentences. Concrete examples from actual shipping. "I shipped X" beats "teams should think about Y."',
      'Avoid: jargon, corporate-speak, generic startup advice, hype, thread-formatted "1/10" posts.',
    ].join('\n'),
    suggested_promotions: '',
    suggested_reference_links: [
      '• {Your project} → https://yourdomain.com',
      '• Side project / toolkit → https://yourdomain.com/toolkit',
    ].join('\n'),
    suggested_design_language: 'Bold typographic cards. Minimal chrome. Big numbers, short lines. Sans-serif.',
    suggested_brand_accent_hex: '#E11D48',
    suggested_image_font: 'Inter',
  },

  'tech-founder': {
    key: 'tech-founder',
    name: 'Tech founder',
    description: 'Building a product. Want to share build-in-public stories.',
    suggested_uber_goal: 'Share the honest story of building {your product} — the wins, the unsexy fixes, the numbers.',
    suggested_brand_voice: [
      'Founder of {your company}. Building {what it is} for {who it serves}.',
      '{Your background in one line}.',
      '',
      'Voice: real numbers, real lessons, no hype. Engineering-minded. Contrarian when the common advice misses.',
      'Always: specific metrics, specific constraints, specific decisions.',
      'Avoid: "we should all...", generic advice, VC-speak, humble-brags.',
    ].join('\n'),
    suggested_promotions: '',
    suggested_reference_links: [
      '• {Your company} → https://yourdomain.com',
      '• Status / changelog → https://yourdomain.com/changelog',
    ].join('\n'),
    suggested_design_language: 'Clean sans-serif. Product-style posters. Functional hierarchy.',
    suggested_brand_accent_hex: '#4F46E5',
    suggested_image_font: 'Inter',
  },

  'indie-hacker': {
    key: 'indie-hacker',
    name: 'Indie hacker',
    description: 'Solo builder. Ship small, ship often, ship in public.',
    suggested_uber_goal: 'Document the journey from zero to sustainable indie revenue. Teach what works + what doesn\'t.',
    suggested_brand_voice: [
      'Solo builder. {Your current MRR / goal if any}. Works in public.',
      '',
      'Voice: casual, honest, specific. No team-voice. Own mistakes publicly. Real revenue + user counts over vanity metrics.',
      'Always: what broke this week, what the fix was, what you learned.',
      'Avoid: corporate tone, pretending to have a team, faking traction.',
    ].join('\n'),
    suggested_promotions: '',
    suggested_reference_links: [
      '• Current project → https://yourdomain.com',
      '• Newsletter → https://yourdomain.com/newsletter',
    ].join('\n'),
    suggested_design_language: 'Casual, hand-made feel. Quirky sans. Personality over polish.',
    suggested_brand_accent_hex: '#EA580C',
    suggested_image_font: 'Space Grotesk',
  },

  'writer-journalist': {
    key: 'writer-journalist',
    name: 'Writer / Journalist',
    description: 'Publish essays, takes, analyses. Twitter is for distribution.',
    suggested_uber_goal: 'Publish one essay a week. Use Twitter + LinkedIn to surface the work to the right readers.',
    suggested_brand_voice: [
      'Writes about {your beat}. Published in {your outlets}.',
      '',
      'Voice: essayistic, structured, citation-first. Opinions are earned with evidence. Long-form sensibility compressed to short form.',
      'Always: link the source, name the counter-argument, land the thesis in one sentence.',
      'Avoid: clickbait framing, outrage, unsourced claims, cheap hooks.',
    ].join('\n'),
    suggested_promotions: '',
    suggested_reference_links: [
      '• Writing / blog → https://yourdomain.com',
      '• Newsletter → https://yourdomain.com/subscribe',
    ].join('\n'),
    suggested_design_language: 'Editorial magazine feel. Serif headline + sans body. Restrained, literary.',
    suggested_brand_accent_hex: '#0F172A',
    suggested_image_font: 'Lora',
  },

  'engineering-manager': {
    key: 'engineering-manager',
    name: 'Engineering manager',
    description: 'Teach leadership, systems, hiring. Share lessons from the org chart.',
    suggested_uber_goal: 'Share what actually works inside engineering teams — hiring, mentorship, delivery, scale.',
    suggested_brand_voice: [
      '{Your title} at {your company}. Leading {team size / scope}.',
      '{Your years} years as an IC + {Y} years as a manager.',
      '',
      'Voice: observational, measured, specific to real situations. Anonymized stories, named principles.',
      'Always: actionable advice, real anti-patterns, trade-offs named explicitly.',
      'Avoid: hot takes for engagement, naming individuals, making it about you.',
    ].join('\n'),
    suggested_promotions: '',
    suggested_reference_links: [
      '• Personal site → https://yourdomain.com',
      '• Hiring / blog → https://yourdomain.com/writing',
    ].join('\n'),
    suggested_design_language: 'Professional, clean, typographic. IBM Plex feel.',
    suggested_brand_accent_hex: '#0369A1',
    suggested_image_font: 'IBM Plex Sans',
  },

  'blank': {
    key: 'blank',
    name: 'Start from scratch',
    description: 'Fill everything in yourself. No starting content.',
    suggested_uber_goal: '',
    suggested_brand_voice: '',
    suggested_promotions: '',
    suggested_reference_links: '',
    suggested_design_language: '',
    suggested_brand_accent_hex: '',
    suggested_image_font: 'Inter',
  },
};

// Public, browser-safe listing (no internal fields, just the pick-list).
function listPersonas() {
  return Object.keys(PERSONAS).map(function (k) {
    const p = PERSONAS[k];
    return { key: p.key, name: p.name, description: p.description };
  });
}

function getPersona(key) {
  return PERSONAS[key] || null;
}

module.exports = { PERSONAS, listPersonas, getPersona };
