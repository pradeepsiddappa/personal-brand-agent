// ─────────────────────────────────────────────────────────
// templates.js — built-in tweet format library
// ─────────────────────────────────────────────────────────
// 8 formats that carry most of AI Twitter. Writer picks a DIFFERENT
// template per draft so a single run mixes structure (one DROP, one
// BUILD LOG, one HOT TAKE, etc) instead of 3 teachy-teaching tweets.
//
// Users can append their own templates via the Settings field
// `tweet_templates` — those get concatenated after these defaults.
// ─────────────────────────────────────────────────────────

const DEFAULT_TEMPLATES = [
  {
    name: 'breaking-drop',
    when: 'A tool / product / repo that\'s ramping (new launch, trending GitHub, PH #1). Best when the signal has a specific metric.',
    pattern: [
      'BREAKING: Someone built [ONE-LINE big claim, specific verb].',
      '',
      '[ProjectName] is a [category in 5 words]. And [hype beat — "scarily accurate" / "actually works" / "10x faster"].',
      '',
      'Here\'s what it actually does:',
      '',
      '→ [Concrete capability 1]',
      '→ [Concrete capability 2]',
      '→ [Concrete capability 3]',
      '→ [Concrete capability 4]',
      '',
      '[One paragraph on why this matters — anchor in a real use case].',
      '',
      '[Metric]. [Growth rate].',
      '',
      '[Licensing / access kicker — "It\'s open source." / "Free for makers." etc.]',
    ].join('\n'),
  },
  {
    name: 'hot-take',
    when: 'A contrarian opinion you can defend with 2-3 specifics. Use when signals include a debate or divisive claim.',
    pattern: [
      '[Contrarian one-liner that stops the scroll].',
      '',
      '[Setup: what most people think / the conventional wisdom].',
      '',
      '[The sharp flip — why that view misses the point].',
      '',
      '[What\'s actually true, with one specific example].',
      '',
      '[Kicker — what to do differently].',
    ].join('\n'),
  },
  {
    name: 'build-log',
    when: 'Personal shipping. Something YOU built or fixed recently. Grounded in actual work, not abstract.',
    pattern: [
      'Shipped [specific thing] at [your project] today.',
      '',
      '[One specific thing that surprised me].',
      '',
      '[The real constraint I hit, in concrete terms].',
      '',
      '[What I\'d do differently next time].',
      '',
      '[Optional: link from library if relevant].',
    ].join('\n'),
  },
  {
    name: 'teach-1-thing',
    when: 'A single insight worth 280 characters. From your own work. Anchored in real numbers.',
    pattern: [
      'Most [audience] miss this:',
      '',
      '[The insight in one clean line].',
      '',
      'Why it matters: [concrete consequence].',
      '',
      'How to apply it: [one concrete action].',
      '',
      '[Source: my own experience shipping X — real number or specific project].',
    ].join('\n'),
  },
  {
    name: 'list-post',
    when: 'A numbered list of 3-5 items. Great for toolkits, frameworks, or habit posts.',
    pattern: [
      '[N] [things] that changed how I [verb] [object]:',
      '',
      '1. [Thing] - [one-line why]',
      '2. [Thing] - [one-line why]',
      '3. [Thing] - [one-line why]',
      '',
      '#[N] is the one nobody talks about.',
    ].join('\n'),
  },
  {
    name: 'counter-intuitive',
    when: 'Flip a common piece of advice. Best when you have real evidence it\'s wrong (or incomplete).',
    pattern: [
      'Everyone says [common advice in 5-8 words].',
      '',
      'They\'re not wrong. They\'re incomplete.',
      '',
      '[What actually works, in one sentence].',
      '',
      '[One specific example from shipping something real — a project, a job, a side build].',
      '',
      '[Kicker — what the framing misses].',
    ].join('\n'),
  },
  {
    name: 'personal-milestone',
    when: 'A specific achievement or number worth marking. Ground it in the unsexy work that got you there.',
    pattern: [
      '[Specific number / moment — "200 users shipped", "1,000 signups", "hit X metric"].',
      '',
      '[The context in one line].',
      '',
      'The unsexy truth: [what actually got us here — not the glamorous answer].',
      '',
      '[Lesson or what\'s next].',
    ].join('\n'),
  },
  {
    name: 'quote-take',
    when: 'Reacting to a tweet from the inspiration voice examples. Keep it sharp and additive — either amplify with your experience or flip with care.',
    pattern: [
      '[Sharp 1-2 line reaction to the referenced tweet].',
      '',
      '[Either: "I\'ve seen this at X" with a specific example,',
      ' or:     "This is half the story. Here\'s the other half:" + your flip].',
    ].join('\n'),
  },
];

/**
 * Build the Writer's TEMPLATE LIBRARY block — built-in defaults plus any
 * custom templates the user saved in settings.tweet_templates.
 */
function templatesBlock(userCustom) {
  const lines = [
    'TEMPLATE LIBRARY — pick a DIFFERENT template for each of the 3 drafts so the run mixes formats (one DROP, one BUILD LOG, one HOT TAKE — not three teach-1-thing in a row). Fill the bracketed placeholders with content from signals + your background; do NOT leave [brackets] visible in the output tweet.',
    '',
  ];
  for (const t of DEFAULT_TEMPLATES) {
    lines.push('### Template: ' + t.name);
    lines.push('When to use: ' + t.when);
    lines.push('Pattern:');
    lines.push(t.pattern);
    lines.push('');
  }
  if (userCustom && userCustom.trim()) {
    lines.push('### User custom templates (use these too):');
    lines.push(userCustom.trim());
  }
  return lines.join('\n');
}

module.exports = { DEFAULT_TEMPLATES, templatesBlock };
