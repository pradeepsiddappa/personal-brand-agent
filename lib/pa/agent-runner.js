// ─────────────────────────────────────────────────────────
// agent-runner.js — shared execution logic
// ─────────────────────────────────────────────────────────
// Resolves an agent definition by id, decrypts the user's Claude key,
// substitutes variables into the prompt template, and calls the
// appropriate agent handler.
// ─────────────────────────────────────────────────────────

const { admin } = require('./supabase');
const { decrypt } = require('./crypto');
const { complete } = require('./claude');
const { renderSvg, svgToPng } = require('./image');
const { postToTwitter, postThreadToTwitter, uploadTwitterMedia } = require('./twitter');
const { postToLinkedIn, uploadLinkedInImage } = require('./linkedin');
const { sendDraftCard, sendSeoCard } = require('./telegram');
const { templatesBlock } = require('./templates');

async function loadAgent(userId, agentId) {
  const sb = admin();
  const { data, error } = await sb.from('agents_config').select('*').eq('user_id', userId).eq('id', agentId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Agent not found: ${agentId}`);
  return data;
}

async function loadSettings(userId) {
  const sb = admin();
  const { data, error } = await sb.from('settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || {};
}

function substitute(template, vars) {
  return (template || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
}

async function logEvent(userId, agent, kind, title, detail, tag, refId) {
  const sb = admin();
  await sb.from('events').insert({
    user_id: userId,
    agent,
    kind,
    title,
    detail,
    tag,
    ref_id: refId,
  });
}

/**
 * Extract JSON from a Claude response (handles markdown fences + bare JSON).
 */
function parseClaudeJson(text) {
  if (!text) return null;
  // Strip ```json ... ``` fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  try {
    return JSON.parse(body.trim());
  } catch (e) {
    return null;
  }
}

/** Random ID like P-A3F9 */
function newDraftId() {
  return 'P-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

/** Pick a card palette based on category. */
function paletteFor(category) {
  if (category === 'builder-proof') return 'indigo';
  if (category === 'point-of-view') return 'orange';
  if (category === 'teaching')      return 'emerald';
  return 'indigo';
}

/** Pick an icon based on category / keywords. */
// Extract URL/domain patterns the user owns from settings.
// Used to set first-person vs third-person voice in the prompt.
function extractOwnedPatterns(settings) {
  const patterns = new Set();
  // Mine the reference_links field — every URL in there is implicitly the
  // user's project. Strip the path so we match all sub-pages.
  const refLinks = String(settings.reference_links || '');
  const urlRe = /https?:\/\/([a-z0-9.-]+)(\/[A-Za-z0-9_\/-]*)?/gi;
  let m;
  while ((m = urlRe.exec(refLinks)) !== null) {
    const host = m[1].replace(/^www\./, '').toLowerCase();
    const path = m[2] || '';
    patterns.add(host);
    // Also store the path-prefixed form for repos like github.com/user/*
    if (path && path.indexOf('/') !== -1) {
      const firstSeg = path.split('/').filter(Boolean)[0];
      if (firstSeg) patterns.add(host + '/' + firstSeg);
    }
  }
  // Always include the website_url host if set.
  if (settings.website_url) {
    try { patterns.add(new URL(settings.website_url).host.replace(/^www\./, '')); }
    catch {}
  }
  return Array.from(patterns);
}

// Voice mix instructions for the prompt.
// Default weighting: build-log no-pronoun (60%), project-as-subject (20%),
// past-tense narrative (10%), first-person opinion (10%).
const VOICE_MIX_RULES = [
  'VOICE MIX (when writing about something the user owns):',
  '  60% BUILD-LOG style: no pronoun, action-led. "Shipped X.", "Just fixed Y.", "Cut Z to one step."',
  '  20% PROJECT-AS-SUBJECT: "{Your project name} now does X." "Shipped feature Y this week."',
  '  10% PAST-TENSE NARRATIVE: "Built this last week to solve Z."',
  '  10% FIRST-PERSON ("I"): reserved for opinion/teaching ("I think", "My take").',
  '  NEVER use "Someone built" / "A user shipped" / generic third person for the user\'s own projects.',
  '  NEVER use "We" — this is a personal brand, not a company.',
].join('\n');


// Used to reject Claude's partial responses (e.g. { kind: 'milestone',
// eyebrow: 'Just shipped' } with no title — the card renders as a lone
// dot + icon on an empty background).
function hasImageContent(spec) {
  if (!spec || typeof spec !== 'object') return false;
  const s = function (v) { return typeof v === 'string' && v.trim().length > 0; };
  const arr = function (v) { return Array.isArray(v) && v.length > 0; };
  const kind = spec.kind;
  // Each card has ONE primary text field that must be populated.
  if (kind === 'stat')      return s(spec.number) && s(spec.label);
  if (kind === 'poster')    return s(spec.headline) && (s(spec.cta_url) || arr(spec.bullets) || s(spec.sub));
  if (kind === 'milestone') return s(spec.title);            // title is the main visual
  if (kind === 'lesson')    return s(spec.body);             // body is the main visual
  if (kind === 'quote')     return s(spec.quote);
  return false;
}

function iconFor(category, text) {
  const t = (text || '').toLowerCase();
  // Order matters — check specific terms before generic categories.
  if (/\b(ship|shipped|launch|launched|released)\b/.test(t))     return 'rocket';
  if (/\b(fix|fixed|debug|regex|bug)\b/.test(t))                 return 'hammer';
  if (/\b(code|coding|build|building|developer|engineer)\b/.test(t)) return 'code';
  if (/\b(teach|taught|learn|learned|lesson|student|cohort)\b/.test(t)) return 'graduation-cap';
  if (/\b(ai|agent|claude|gpt|llm|model|prompt)\b/.test(t))      return 'brain';
  if (/\b(grow|growth|trend|viral|traction)\b/.test(t))          return 'trending';
  if (/\b(community|users|customers|audience|members)\b/.test(t)) return 'users';
  if (/\b(design|ux|ui|figma|interface)\b/.test(t))              return 'palette';
  if (/\b(write|writing|content|tweet|post|blog)\b/.test(t))     return 'pen';
  if (/\b(money|revenue|price|charge|paid|cost|₹|\$)\b/.test(t)) return 'zap';
  if (/\b(idea|think|thought|insight|realize)\b/.test(t))        return 'lightbulb';
  if (category === 'teaching')      return 'graduation-cap';
  if (category === 'builder-proof') return 'hammer';
  if (category === 'point-of-view') return 'sparkles';
  return 'sparkles';
}

// Extract the strongest standalone number from a piece of text.
// Returns { number, context } where context is the label-worthy phrase
// around the number. Returns null if nothing useful is there.
function extractStat(text) {
  if (!text) return null;
  // Match numbers with optional +, %, k, x suffix, or currency prefix.
  // Use word boundaries so "0" in "200+" doesn't match on its own.
  const re = /\b(\$?\d{1,4}(?:,\d{3})*(?:\.\d+)?[+%]?|\d+x|\d+k|\d+m)\b/gi;
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({ token: m[1], index: m.index });
  }
  if (matches.length === 0) return null;
  // Prefer the FIRST number that's bigger than 1 (avoids "1 minute" being
  // picked over "200+ students"). Small numbers in lists get deprioritized.
  matches.sort(function (a, b) {
    const na = parseInt(String(a.token).replace(/[^0-9]/g, ''), 10) || 0;
    const nb = parseInt(String(b.token).replace(/[^0-9]/g, ''), 10) || 0;
    if (na === nb) return a.index - b.index;   // tie → earliest
    if (na < 5 && nb >= 5) return 1;            // small numbers after big
    if (nb < 5 && na >= 5) return -1;
    return nb - na;                             // biggest first
  });
  const pick = matches[0];
  // Grab the 1-2 nearest NOUNS after the number as the label. Keep it short
  // so stat cards don't repeat a phrase that's already in the headline (e.g.
  // if the headline says "200+ students in 2 years" and the label also says
  // "students in 2 years", you're reading the same thing twice).
  const after = text.slice(pick.index + pick.token.length).trim();
  const nearWords = after.split(/[.!?\n]/)[0].split(/\s+/);
  // Drop articles + prepositions so we land on the content word.
  const stop = new Set(['', 'a', 'an', 'the', 'of', 'in', 'on', 'for', 'at', 'to', 'from', 'with', 'and', 'or', 'per']);
  const kept = [];
  for (const w of nearWords) {
    const clean = w.replace(/[,;:.]$/g, '');
    if (!clean || stop.has(clean.toLowerCase())) {
      if (kept.length >= 1) break;    // stop after we've got at least one real word
      continue;
    }
    kept.push(clean);
    if (kept.length >= 2) break;      // cap at 2 words
  }
  const label = kept.join(' ').trim();
  return { number: pick.token, label: label || '' };
}

// Extract a bold, noun-y headline from free text. Takes the first
// declarative sentence, trims to 6-8 words, strips trailing punctuation.
function extractHeadline(text, maxWords) {
  if (!text) return '';
  const firstSentence = String(text).split(/[.!?\n]/)[0].trim();
  const words = firstSentence.split(/\s+/);
  const limit = maxWords || 10;
  return words.slice(0, limit).join(' ').replace(/[,;:]\s*$/, '').trim();
}

// ─────────────────────────────────────────────────────────
// runAgent — manual + scheduled entry point
// ─────────────────────────────────────────────────────────

async function runAgent(userId, agentId, opts) {
  opts = opts || {};
  const agent = await loadAgent(userId, agentId);
  if (!agent.enabled) {
    await logEvent(userId, agentId, 'run', `${agent.name} skipped`, 'agent disabled', 'skipped');
    return { skipped: true, reason: 'disabled' };
  }
  // Respect a user-set pause unless the caller explicitly overrides (manual "Run now").
  if (!opts.force && agent.paused_until && new Date(agent.paused_until) > new Date()) {
    await logEvent(userId, agentId, 'run', `${agent.name} skipped`,
      'paused until ' + agent.paused_until, 'paused');
    return { skipped: true, reason: 'paused', paused_until: agent.paused_until };
  }

  const settings = await loadSettings(userId);
  await logEvent(userId, agentId, 'run', `${agent.name} started`, '', 'started');

  try {
    let result;
    switch (agentId) {
      case 'scout':     result = await runScout(userId, agent, settings); break;
      case 'writer':    result = await runWriter(userId, agent, settings); break;
      case 'editor':    result = await runEditor(userId, agent, settings); break;
      case 'messenger': result = await runMessenger(userId, agent, settings); break;
      case 'publisher': result = await runPublisher(userId, agent, settings); break;
      case 'analyst':   result = await runAnalyst(userId, agent, settings); break;
      case 'seo':       result = await runSeo(userId, agent, settings); break;
      default:          result = await runGeneric(userId, agent, settings);
    }
    await logEvent(userId, agentId, 'run', `${agent.name} done`, JSON.stringify(result).slice(0, 200), 'ok');
    return result;
  } catch (e) {
    await logEvent(userId, agentId, 'run', `${agent.name} failed`, e.message, 'error');
    throw e;
  }
}

// ─────────────────────────────────────────────────────────
// Agent handlers
// ─────────────────────────────────────────────────────────

// Reduce the uber goal to 3-6 keywords we can use for HN search.
// Strips stopwords, picks the most content-bearing tokens.
function keywordsFromGoal(uberGoal) {
  if (!uberGoal) return ['ai', 'design', 'founder'];
  var stop = new Set(('a the and or but for on in at to of with from my your our as is are be being been i me you ' +
    'establish share build learn lesson daily myself trusted voice people other others can who what why how ' +
    'about into them this that these those it its so just also very really want make get going going like lot ' +
    'more most less few some any all new one two three twitter linkedin post posts posting').split(/\s+/));
  return Array.from(new Set(
    String(uberGoal).toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(function (t) { return t && t.length > 2 && !stop.has(t); })
  )).slice(0, 6);
}

// Hit the free HN Algolia API for recent stories matching a query.
async function fetchHnSignals(query, limit) {
  const url = 'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=' + (limit || 10) +
    '&query=' + encodeURIComponent(query);
  const r = await fetch(url, { headers: { 'User-Agent': 'personal-agent/1.0' } });
  if (!r.ok) throw new Error('HN Algolia ' + r.status);
  const json = await r.json();
  return (json.hits || []).filter(function (h) { return h.title; }).map(function (h) {
    return {
      source: 'hackernews',
      author: h.author || 'hn',
      url: h.url || ('https://news.ycombinator.com/item?id=' + h.objectID),
      excerpt: h.title + (h._highlightResult && h._highlightResult.story_text ? ' — ' + h._highlightResult.story_text.value : ''),
      topics: (h._tags || []).filter(function (t) { return !t.startsWith('author_') && t !== 'story'; }),
      score: h.points || 0,
    };
  });
}

// Reddit JSON API — public, no auth. Pulls hot posts from a subreddit list.
// We rotate subreddits per keyword so we don't hammer one feed.
// Generic subreddit pool. Users can override via settings.reddit_subs (TODO)
// once that setting lands. For now these cover common builder/creator spaces.
const REDDIT_SUBS = ['design', 'sideproject', 'webdev', 'Entrepreneur', 'startups', 'artificial', 'SaaS'];
async function fetchRedditSignals(query, limit) {
  // Pick 2 subs at random per call to vary the surface area.
  const picks = REDDIT_SUBS.sort(function () { return Math.random() - 0.5; }).slice(0, 2);
  let out = [];
  for (const sub of picks) {
    try {
      const url = 'https://www.reddit.com/r/' + sub + '/search.json?restrict_sr=1&sort=top&t=week' +
        '&limit=' + (limit || 5) + '&q=' + encodeURIComponent(query);
      const r = await fetch(url, { headers: { 'User-Agent': 'personal-agent/1.0' } });
      if (!r.ok) continue;
      const json = await r.json();
      const posts = (json.data && json.data.children) || [];
      for (const p of posts) {
        const d = p.data;
        if (!d || !d.title) continue;
        out.push({
          source: 'reddit',
          author: 'r/' + sub,
          url: 'https://www.reddit.com' + d.permalink,
          excerpt: d.title + (d.selftext ? ' — ' + d.selftext.slice(0, 200) : ''),
          topics: [sub],
          score: d.score || 0,
        });
      }
    } catch { /* swallow per-sub errors */ }
  }
  return out;
}

// Dev.to public articles API — no auth.
async function fetchDevtoSignals(query, limit) {
  try {
    const url = 'https://dev.to/api/articles?per_page=' + (limit || 5) +
      '&tag=' + encodeURIComponent(query.split(/\s+/)[0]);
    const r = await fetch(url, { headers: { 'User-Agent': 'personal-agent/1.0' } });
    if (!r.ok) return [];
    const arr = await r.json();
    return (arr || []).map(function (a) {
      return {
        source: 'devto',
        author: a.user && a.user.username ? '@' + a.user.username : 'dev.to',
        url: a.url,
        excerpt: a.title + (a.description ? ' — ' + a.description : ''),
        topics: a.tag_list || [],
        score: (a.public_reactions_count || 0) + (a.comments_count || 0) * 2,
      };
    });
  } catch { return []; }
}

async function runScout(userId, agent, settings) {
  const sb = admin();
  const keywords = keywordsFromGoal(settings.uber_goal);

  // De-dupe against signals from the last 72h so we don't re-log the same story.
  const since = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await sb.from('signals')
    .select('url')
    .eq('user_id', userId)
    .gte('created_at', since);
  const seen = new Set((recent || []).map(function (s) { return s.url; }));

  let collected = [];
  let errors = [];
  // Three sources in parallel per keyword: HN, Reddit, Dev.to.
  for (const kw of keywords) {
    try {
      const [hn, rd, dt] = await Promise.all([
        fetchHnSignals(kw, 4).catch(function (e) { errors.push('hn:' + kw + ':' + e.message); return []; }),
        fetchRedditSignals(kw, 4).catch(function (e) { errors.push('rd:' + kw + ':' + e.message); return []; }),
        fetchDevtoSignals(kw, 4).catch(function (e) { errors.push('dt:' + kw + ':' + e.message); return []; }),
      ]);
      for (const h of [].concat(hn, rd, dt)) {
        if (h.url && !seen.has(h.url)) {
          collected.push(h);
          seen.add(h.url);
        }
      }
    } catch (e) {
      errors.push(kw + ': ' + e.message);
    }
  }

  // Sort by score, keep top 12 across sources.
  collected.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
  collected = collected.slice(0, 12);

  if (collected.length === 0) {
    await logEvent(userId, 'scout', 'signal', 'No new signals',
      'Searched HN/Reddit/Dev.to for: ' + keywords.join(', ') + (errors.length ? ' · errors: ' + errors.join('; ') : ''), 'empty');
    return { message: 'No fresh signals found for keywords: ' + keywords.join(', '), signalsFound: 0 };
  }

  const rows = collected.map(function (c) {
    return {
      user_id: userId,
      source: c.source,
      author: c.author,
      url: c.url,
      excerpt: String(c.excerpt || '').slice(0, 500),
      topics: c.topics || [],
    };
  });
  await sb.from('signals').insert(rows);

  // Source breakdown for the UI: "5 HN · 4 Reddit · 3 Dev.to"
  const byCount = collected.reduce(function (acc, c) { acc[c.source] = (acc[c.source] || 0) + 1; return acc; }, {});
  const breakdown = Object.keys(byCount).map(function (k) { return byCount[k] + ' ' + k; }).join(' · ');
  await logEvent(userId, 'scout', 'signal', 'Signals recorded',
    breakdown + ' (keywords: ' + keywords.join(', ') + ')', 'ok');

  return { message: collected.length + ' signals (' + breakdown + ')', signalsFound: collected.length, keywords: keywords };
}

/**
 * Writer: calls Claude, creates drafts. If Claude returns an image_prompt
 * or image_spec, renders an SVG card and stores it on the draft.
 */
async function runWriter(userId, agent, settings) {
  const claudeKey = settings.claude_key_enc ? decrypt(settings.claude_key_enc) : null;
  if (!claudeKey) throw new Error('Claude API key not set in Settings');

  // Pull recent signals (last 24h, top 10)
  const sb = admin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: sigs } = await sb
    .from('signals')
    .select('source, author, excerpt, topics')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);

  const signalsText = (sigs && sigs.length)
    ? sigs.map(s => `- [${s.source}] ${s.author || ''}: ${s.excerpt}`).join('\n')
    : '(no fresh signals — draft based on the user\'s evergreen themes from brand voice)';

  // Voice anchors = (a) the user's own approved drafts and
  //                 (b) tweets they forwarded to the Telegram bot as inspiration.
  const { data: approved } = await sb
    .from('drafts')
    .select('text, category')
    .eq('user_id', userId)
    .eq('stage', 'done')
    .order('posted_at', { ascending: false })
    .limit(6);

  const { data: inspirations } = await sb
    .from('voice_examples')
    .select('text, note')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(8);

  const ownExamples = (approved || []).map(d => `- (${d.category}) ${d.text}`);
  const inspExamples = (inspirations || []).map(v => `- (inspiration${v.note ? ' · ' + v.note : ''}) ${v.text}`);
  const combined = ownExamples.concat(inspExamples);

  const examplesText = combined.length
    ? combined.join('\n')
    : '(no approved posts or inspirations yet — draft in the user\'s brand voice from settings, short sentences, no jargon)';

  const uberGoal   = settings.uber_goal   || 'Grow a personal brand on Twitter';
  const brandVoice = settings.brand_voice || '';
  const websiteUrl = settings.website_url || '';
  const promotions = settings.promotions  || '';
  const tpl = agent.prompt_template || '';

  // Substitute {{placeholders}} if the template has them (new prompts).
  // For stale templates without the placeholders, we PREPEND the context
  // as its own block so brand voice / promotions / voice examples still
  // reach Claude even if the user hasn't clicked Reset on the Writer card.
  const substituted = substitute(tpl, {
    uber_goal: uberGoal,
    brand_voice: brandVoice
      ? 'BRAND VOICE & POSITIONING (mirror this — match the tone, vocabulary, and themes):\n' + brandVoice
      : '',
    promotions: promotions
      ? 'ACTIVE PROMOTIONS (pick ONE and weave it into AT LEAST ONE of the 3 drafts — use a `poster` image_spec with eyebrow, headline, accent_word, sub, bullets, cta_label, cta_url):\n' + promotions
      : '',
    website: websiteUrl,
    signals: signalsText,
    approved_examples: examplesText,
  });

  // If the template is missing key placeholders, build a prefix block so the
  // new context still makes it into Claude's input. This is the safety net
  // for users whose seeded prompt_template predates these fields.
  const hadBrand    = /\{\{\s*brand_voice\s*\}\}/.test(tpl);
  const hadPromo    = /\{\{\s*promotions\s*\}\}/.test(tpl);
  const hadUber     = /\{\{\s*uber_goal\s*\}\}/.test(tpl);
  const hadSignals  = /\{\{\s*signals\s*\}\}/.test(tpl);
  const hadExamples = /\{\{\s*approved_examples\s*\}\}/.test(tpl);

  const designLanguage = settings.design_language || '';
  const accentHex      = settings.brand_accent_hex || '';
  const referenceLinks = settings.reference_links  || '';
  const templatesText  = templatesBlock(settings.tweet_templates || '');

  const prefixParts = [];
  if (!hadUber)     prefixParts.push('UBER GOAL:\n' + uberGoal);
  if (!hadBrand    && brandVoice) prefixParts.push('BRAND VOICE & POSITIONING (mirror this):\n' + brandVoice);
  if (designLanguage) prefixParts.push('DESIGN LANGUAGE (apply to every image_spec you generate):\n' + designLanguage);
  if (accentHex)      prefixParts.push('BRAND ACCENT COLOR: ' + accentHex + ' (the server will apply this to every card; no need to include hex values in image_spec)');
  if (referenceLinks) prefixParts.push('LINK LIBRARY — when a draft is SPECIFICALLY about one of these, append the matching URL to the tweet text (as the final token, no trailing period). If nothing in this list is the topic, DO NOT force a link in:\n' + referenceLinks);
  const ownedPatterns = extractOwnedPatterns(settings);
  if (ownedPatterns.length > 0) {
    prefixParts.push('OWNED URLS / PROJECTS (these belong to the user — write about them in FIRST-PERSON / PROJECT-AS-SUBJECT, NEVER as "Someone built" / "A user shipped"):\n' +
      ownedPatterns.map(function (p) { return '  • ' + p; }).join('\n'));
    prefixParts.push(VOICE_MIX_RULES);
  }
  if (!hadPromo    && promotions) prefixParts.push('ACTIVE PROMOTIONS — ONE of the 3 drafts MUST be a poster-kind promo with the URL from this list:\n' + promotions);
  if (!hadSignals)  prefixParts.push('RECENT SIGNALS FROM THE WEB:\n' + signalsText);
  if (!hadExamples) prefixParts.push('VOICE EXAMPLES (approved drafts + tweets you forwarded to Telegram — match this voice, not a generic "philosophical" tone):\n' + examplesText);
  prefixParts.push(templatesText);

  // Critical instruction always appended, independent of template drift.
  const hardRules = [
    'HARD RULES (OVERRIDE ANY CONFLICTING INSTRUCTIONS ABOVE):',
    '- Return EXACTLY 3 drafts as a JSON array. Not 1. Not 2.',
    '- Every draft MUST include an image_spec (not null).',
    '- Each of the 3 drafts MUST use a DIFFERENT template from the TEMPLATE LIBRARY — do not repeat a format within a single run.',
    '- Attach the template name you used to each draft as a top-level field: "template_name".',
    '- Every draft MUST include TWO text versions:',
    '    "text":          Twitter-native. Short, punchy. Max 280 chars. Arrow bullets (→) OK, minimal emojis, no "1/10" markers.',
    '    "text_linkedin": LinkedIn-native. 400–1200 chars. Full sentences in paragraphs, no arrow bullets, no hashtags. Professional tone without being corporate. Opens with a hook line, body expands with specifics, closes with one clear takeaway. Do not copy the Twitter version verbatim — rewrite for the medium.',
    '- Fill bracketed placeholders in the chosen template with concrete content from signals + voice examples + user background. DO NOT ship tweets that still contain [brackets].',
    '- NO HALLUCINATED NAMES. Never invent a product, company, or project name. If a template needs a project name, it MUST come from: (a) a URL/title in RECENT SIGNALS, (b) the LINK LIBRARY, or (c) the user\'s own projects documented in BRAND VOICE. If no real named project is available for a template, SKIP that template and pick another.',
    '- NO HALLUCINATED FACTS. Never invent timeframes ("in 2 years", "since 2020"), durations ("6 months of work"), sizes ("10K users", "1M revenue"), dates, or outcomes UNLESS those exact values appear in BRAND VOICE, SEED TEXT, SOURCES/SIGNALS, or LINK LIBRARY. When unsure about a number or duration, OMIT it — "200+ students" alone beats "200+ students in 2 years" if "2 years" isn\'t a documented fact.',
    '- If ACTIVE PROMOTIONS has content, ONE of the 3 MUST use image_spec.kind="poster" with the promotion URL in cta_url (any template is fine — typically breaking-drop or personal-milestone).',
    '- Ground drafts in the RECENT SIGNALS above or the user\'s real background. NO abstract metaphors (no "A-10 Warthog", "boring is beautiful" philosophy, etc).',
    '- Mirror the VOICE EXAMPLES — short sentences, specific numbers, first-person, India-rooted.',
  ].join('\n');

  const prompt = (prefixParts.length ? prefixParts.join('\n\n') + '\n\n' : '') + substituted + '\n\n' + hardRules;

  const { text: raw } = await complete(claudeKey, {
    system: 'You are Writer. Produce ONLY valid JSON. No prose before or after.',
    user: prompt,
    // 3 drafts × (tweet + image_spec + template_name) ≈ 3000 tokens. Give
    // headroom so Claude doesn't truncate mid-JSON and we end up parsing
    // a partial array (which is how "only 1 draft" kept reaching you).
    maxTokens: 4500,
  });

  const parsed = parseClaudeJson(raw) || [];
  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (items.length < 3) {
    console.warn('[pa] Writer produced', items.length, 'drafts instead of 3. Raw length:', (raw || '').length);
    console.warn('[pa] Writer raw response (first 500 chars):', (raw || '').slice(0, 500));
    console.warn('[pa] Writer raw response (last 500 chars):',  (raw || '').slice(-500));
  }

  const savedIds = [];
  for (const item of items) {
    if (!item || !item.text) continue;
    const draftId = newDraftId();
    const category = item.category || 'point-of-view';

    // Always render an image — image posts get 2-3× engagement. Use the
    // model's image_spec if provided AND populated; otherwise infer one
    // from the text + category. Claude sometimes returns an empty spec
    // (kind without fields) which used to ship blank cards.
    const inferredItemSpec = inferImageSpec(item);
    let imageSpec = hasImageContent(item.image_spec) ? item.image_spec : inferredItemSpec;
    if (!hasImageContent(item.image_spec) && item.image_spec) {
      console.warn('[pa] Writer image_spec rejected for', draftId,
        '· reason: missing primary field · kind was:', item.image_spec.kind,
        '· fields:', Object.keys(item.image_spec).join(','));
    }
    // Apply brand accent + chosen font family so every card carries the
    // user's design system.
    const accentAndFont = {
      brand_accent_hex: settings.brand_accent_hex || undefined,
      font_family: settings.image_font || 'Inter',
    };
    imageSpec = Object.assign({}, imageSpec, accentAndFont);
    let imageSvg = null;
    try {
      imageSvg = renderSvg(imageSpec);
    } catch (e) {
      console.warn('[pa] image render failed for', draftId, e.message);
    }

    await sb.from('drafts').insert({
      id: draftId,
      user_id: userId,
      stage: 'writer',
      category,
      text: String(item.text).slice(0, 280),
      text_linkedin: item.text_linkedin ? String(item.text_linkedin).slice(0, 3000) : null,
      image_svg: imageSvg,
      image_spec: imageSpec,
    });

    const tplName = item.template_name || item.template || '';
    await logEvent(userId, 'writer', 'draft', `Drafted ${draftId}`,
      (tplName ? '[' + tplName + '] ' : '') + String(item.text).slice(0, 100), category, draftId);

    savedIds.push(draftId);
  }

  return { draftsCreated: savedIds.length, draftIds: savedIds };
}

/**
 * Infer a reasonable image spec from a tweet if the model only gave
 * us a vague image_prompt. Simple heuristics — the user can always
 * edit the draft's image_spec later.
 */
function inferImageSpec(item) {
  const text = String(item.text || '');
  const category = item.category || 'point-of-view';
  const palette = paletteFor(category);
  const icon = iconFor(category, text);
  const headline = extractHeadline(text, 10);
  const stat = extractStat(text);

  // Match both https://example.com/... AND bare example.com/... forms,
  // so URLs always land ONLY in the CTA bar regardless of how the user
  // typed them.
  const BARE_URL_RE = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[A-Za-z0-9_\-./?=&%#]*)?/gi;

  // Promo-style content → poster card (multi-line, CTA-friendly).
  // Triggered by common call-to-action phrases or any URL-like token.
  if (BARE_URL_RE.test(text) || /\b(register|join|sign up|apply|book|cohort|workshop|live)\b/i.test(text)) {
    // Extract a representative URL for the CTA bar (prefer https:// form).
    const urlMatch = text.match(/https?:\/\/[^\s]+/) || text.match(BARE_URL_RE);
    const cta_url = urlMatch
      ? urlMatch[0].replace(/^https?:\/\/(?:www\.)?/, '').replace(/[.,;:]+$/, '')
      : '';
    // Strip EVERY URL-like token from the text used for headline + sub + bullets.
    // Reset regex state and clean.
    BARE_URL_RE.lastIndex = 0;
    const cleanText = text.replace(BARE_URL_RE, '').replace(/\s{2,}/g, ' ').trim();

    const lines = cleanText.split(/[.!?\n]+/).map(function (l) { return l.trim(); }).filter(Boolean);
    const eyebrow = (category === 'teaching' ? 'Now open' : 'New') + (stat ? ' · ' + stat.number : '');
    // Cap bullets at 3 short ones so the middle of the poster doesn't overflow.
    const bullets = lines.slice(1, 4).map(function (l) { return l.slice(0, 48); }).filter(function (l) { return l.length > 5; }).slice(0, 3);
    const accent = stat ? stat.number : extractHeadline(cleanText, 10).split(/\s+/).slice(-1)[0];
    return {
      kind: 'poster',
      palette: 'dark',
      eyebrow: eyebrow.toUpperCase(),
      headline: extractHeadline(cleanText, 8) || lines[0] || 'New',
      accent_word: accent,
      // Keep sub short: 1 short sentence max. Longer text goes to bullets.
      sub: (lines[1] || '').slice(0, 80),
      bullets: bullets.length > 0 ? bullets : undefined,
      cta_label: 'View',
      cta_url,
      byline: '',
    };
  }

  // If there's a solid standalone number (≥ 5 or with +/%) and a label phrase,
  // use a stat card — but always include a full headline so the card isn't
  // just a bare number.
  if (stat) {
    return {
      kind: 'stat',
      palette,
      icon,
      number: stat.number,
      label: stat.label || headline.slice(0, 40),
      headline: headline,  // renderer falls back to label if missing
    };
  }

  // Short punchy line → lesson card (eyebrow + body)
  if (text.length < 160) {
    return {
      kind: 'lesson',
      palette,
      icon,
      eyebrow: category === 'teaching' ? 'Lesson' : category === 'builder-proof' ? 'Build log' : 'Take',
      body: text.split(/\n\n/)[0].slice(0, 160),
    };
  }

  // Longer / narrative → milestone card (eyebrow + bold title + subtitle)
  const firstLine = text.split('\n')[0];
  return {
    kind: 'milestone',
    palette,
    icon,
    eyebrow: category === 'builder-proof' ? 'Just shipped' :
             category === 'teaching' ? 'Teaching moment' : 'Worth sharing',
    title: extractHeadline(firstLine, 8),
    subtitle: text.slice(firstLine.length).trim().slice(0, 140),
  };
}

async function runEditor(userId, agent, settings) {
  const claudeKey = settings.claude_key_enc ? decrypt(settings.claude_key_enc) : null;
  if (!claudeKey) throw new Error('Claude API key not set in Settings');

  // Pick the oldest draft still stuck at stage='writer'
  const sb = admin();
  const { data: drafts } = await sb
    .from('drafts')
    .select('*')
    .eq('user_id', userId)
    .eq('stage', 'writer')
    .order('created_at', { ascending: true })
    .limit(1);

  if (!drafts || !drafts.length) return { message: 'No drafts waiting for Editor.' };
  const draft = drafts[0];

  const { data: recent } = await sb
    .from('drafts')
    .select('text')
    .eq('user_id', userId)
    .in('stage', ['messenger', 'publisher', 'done'])
    .order('created_at', { ascending: false })
    .limit(10);

  const prompt = substitute(agent.prompt_template || '', {
    draft_text: draft.text,
    category: draft.category || '',
    recent_posts: (recent || []).map(r => '- ' + r.text).join('\n') || '(no history)',
  });

  const { text: raw } = await complete(claudeKey, {
    system: 'You are Editor. Produce ONLY valid JSON.',
    user: prompt,
    maxTokens: 600,
  });
  const review = parseClaudeJson(raw) || { confidence: 'needs_review', notes: [] };

  const nextStage = review.confidence === 'weak' ? 'rejected' : 'messenger';

  await sb.from('drafts').update({
    editor_notes: review.notes || null,
    confidence: review.confidence,
    stage: nextStage,
  }).eq('id', draft.id);

  await logEvent(userId, 'editor', 'review', `Reviewed ${draft.id}`,
    `confidence=${review.confidence} → ${nextStage}`,
    review.confidence, draft.id);

  return { draftId: draft.id, confidence: review.confidence, stage: nextStage };
}

async function runMessenger(userId, agent, settings) {
  if (!settings.telegram_bot_token_enc) throw new Error('Telegram not configured');

  const sb = admin();
  const { data: drafts } = await sb
    .from('drafts')
    .select('*')
    .eq('user_id', userId)
    .eq('stage', 'messenger')
    .order('created_at', { ascending: true })
    .limit(3);

  if (!drafts || !drafts.length) return { message: 'No drafts waiting for Messenger.' };

  let sent = 0;
  for (const d of drafts) {
    try {
      await sendDraftCard(userId, d);
      await sb.from('drafts').update({ sent_at: new Date().toISOString() }).eq('id', d.id);
      await logEvent(userId, 'messenger', 'sent', `Sent ${d.id} to Telegram`,
        d.text.slice(0, 80), 'sent', d.id);
      sent++;
    } catch (e) {
      await logEvent(userId, 'messenger', 'sent', `Failed ${d.id}`, e.message, 'error', d.id);
    }
  }
  return { sent };
}

/**
 * Publisher — posts an approved draft to Twitter AND LinkedIn (if either
 * is connected). Uses the same PNG (from draft.image_svg) on both.
 *
 * Draft.post_url always points to the Twitter URL if it exists; LinkedIn
 * URL is stored in draft.linkedin_url (or null if LinkedIn isn't set up).
 */
async function runPublisher(userId, agent, settings) {
  const hasTwitterConn  = !!settings.twitter_access_token_enc;
  const hasLinkedInConn = !!settings.linkedin_access_token_enc;
  if (!hasTwitterConn && !hasLinkedInConn) {
    throw new Error('Neither Twitter nor LinkedIn is connected');
  }

  const sb = admin();
  const { data: drafts } = await sb
    .from('drafts')
    .select('*')
    .eq('user_id', userId)
    .eq('stage', 'publisher')
    .order('created_at', { ascending: true })
    .limit(3);

  if (!drafts || !drafts.length) return { message: 'No approved drafts to publish.' };

  let posted = 0;
  const results = [];

  for (const d of drafts) {
    const outcome = { id: d.id, twitter: null, linkedin: null, errors: [] };
    let pngBuffer = null;

    // Honour the user's per-draft platform choice. A draft approved via
    // "Twitter only" gets ['twitter'] on its row; legacy rows with no
    // platforms column default to both.
    const allowedPf = Array.isArray(d.platforms) && d.platforms.length
      ? d.platforms : ['twitter', 'linkedin'];
    const wantTwitter  = hasTwitterConn  && allowedPf.indexOf('twitter')  !== -1;
    const wantLinkedIn = hasLinkedInConn && allowedPf.indexOf('linkedin') !== -1;

    // Render PNG once if the draft has an image — shared across platforms
    if (d.image_svg) {
      try {
        pngBuffer = await svgToPng(d.image_svg);
      } catch (e) {
        outcome.errors.push(`image render: ${e.message}`);
      }
    }

    // ── Twitter ───────────────────────────────────────────
    let twitterUrl = null;
    if (wantTwitter) {
      try {
        let mediaIds;
        if (pngBuffer) {
          try {
            const mediaId = await uploadTwitterMedia(userId, pngBuffer, 'image/png');
            mediaIds = [mediaId];
          } catch (e) {
            outcome.errors.push(`twitter media: ${e.message}`);
          }
        }
        // Thread: chain the parts; image lives on the first tweet only.
        // Long post: Twitter caps at 280, truncate (LinkedIn handles the long form).
        let result;
        if (d.draft_type === 'thread' && Array.isArray(d.thread_parts) && d.thread_parts.length > 0) {
          result = await postThreadToTwitter(userId, d.thread_parts, mediaIds);
        } else {
          const twText = (d.draft_type === 'longpost') ? String(d.text || '').slice(0, 277) + '…' : d.text;
          result = await postToTwitter(userId, twText, mediaIds);
        }
        twitterUrl = result.id ? `https://twitter.com/i/status/${result.id}` : null;
        outcome.twitter = { id: result.id, url: twitterUrl };
      } catch (e) {
        outcome.errors.push(`twitter: ${e.message}`);
      }
    }

    // ── LinkedIn ──────────────────────────────────────────
    let linkedinUrl = null;
    if (wantLinkedIn) {
      try {
        let imageUrn;
        if (pngBuffer) {
          try {
            imageUrn = await uploadLinkedInImage(userId, pngBuffer, 'image/png');
          } catch (e) {
            outcome.errors.push(`linkedin image: ${e.message}`);
          }
        }
        // LinkedIn text preference, in order:
        //   1. d.text_linkedin — the model's LinkedIn-native rewrite
        //   2. joined thread_parts if it's a thread
        //   3. d.text — last resort (the Twitter-shaped version)
        // Longposts set text IS the LinkedIn body, no text_linkedin needed.
        let liText;
        if (d.text_linkedin && d.text_linkedin.trim()) {
          liText = d.text_linkedin;
        } else if (d.draft_type === 'thread' && Array.isArray(d.thread_parts)) {
          liText = d.thread_parts.join('\n\n');
        } else {
          liText = d.text;
        }
        const result = await postToLinkedIn(userId, liText, imageUrn);
        linkedinUrl = result.url;
        outcome.linkedin = { urn: result.postUrn, url: linkedinUrl };
      } catch (e) {
        outcome.errors.push(`linkedin: ${e.message}`);
      }
    }

    // Update draft — "done" if at least one platform succeeded
    const anyPosted = !!(twitterUrl || linkedinUrl);
    if (anyPosted) {
      await sb.from('drafts').update({
        stage: 'done',
        post_id: outcome.twitter?.id || null,
        post_url: twitterUrl,
        linkedin_url: linkedinUrl,
        posted_at: new Date().toISOString(),
      }).eq('id', d.id);
      await logEvent(userId, 'publisher', 'posted', `Posted ${d.id}`,
        [twitterUrl, linkedinUrl].filter(Boolean).join(' · ') || d.text.slice(0, 80),
        'posted', d.id);
      posted++;
    } else {
      await logEvent(userId, 'publisher', 'posted', `Failed ${d.id}`,
        outcome.errors.join(' | '), 'error', d.id);
    }

    results.push(outcome);
  }

  return { posted, results };
}

// ── SEO ────────────────────────────────────────────────────
// Strip a chunk of HTML to plain text + count headings/links.
function parsePageHtml(html) {
  const stripTags = function (s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); };
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaMatch  = html.match(/<meta[^>]+name=['"]description['"][^>]*content=['"]([^'"]*)['"][^>]*>/i)
                  || html.match(/<meta[^>]+content=['"]([^'"]*)['"][^>]*name=['"]description['"][^>]*>/i);
  const h1s = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || []).map(stripTags).slice(0, 5);
  const imgs = (html.match(/<img\b[^>]*>/gi) || []);
  const missingAlt = imgs.filter(function (t) { return !/alt=['"][^'"]+['"]/i.test(t); }).length;
  const aTags = (html.match(/<a\s+[^>]*href=['"]([^'"#]+)['"][^>]*>/gi) || []);
  let internal = 0, external = 0;
  aTags.forEach(function (t) {
    const m = t.match(/href=['"]([^'"]+)['"]/i);
    if (!m) return;
    if (/^https?:\/\//.test(m[1])) external++; else internal++;
  });
  // Body excerpt: strip <head>, scripts, styles, then first 1500 chars.
  const body = html.replace(/<head[\s\S]*?<\/head>/i, '')
                   .replace(/<script[\s\S]*?<\/script>/gi, '')
                   .replace(/<style[\s\S]*?<\/style>/gi, '');
  const bodyText = stripTags(body);
  return {
    title: titleMatch ? stripTags(titleMatch[1]) : '',
    meta_description: metaMatch ? metaMatch[1].slice(0, 200) : '',
    h1s: h1s.join(' | ') || '(none)',
    word_count: bodyText.split(/\s+/).filter(Boolean).length,
    missing_alt_count: missingAlt,
    internal_links: internal,
    external_links: external,
    body_excerpt: bodyText.slice(0, 1500),
  };
}

async function runSeo(userId, agent, settings) {
  const claudeKey = settings.claude_key_enc ? decrypt(settings.claude_key_enc) : null;
  if (!claudeKey) throw new Error('Claude API key not set in Settings');
  const url = settings.website_url;
  if (!url) {
    await logEvent(userId, 'seo', 'insight', 'SEO skipped',
      'Set Settings → Brand context → Website URL first', 'empty');
    return { skipped: true, reason: 'no website_url' };
  }

  // Fetch the page (10s timeout via AbortController).
  const ac = new AbortController();
  const to = setTimeout(function () { ac.abort(); }, 10000);
  let html;
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'personal-agent-seo/1.0' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    html = await r.text();
  } finally { clearTimeout(to); }

  const parsed = parsePageHtml(html);
  const brand = settings.brand_voice || '';
  const prompt = substitute(agent.prompt_template || '', {
    uber_goal: settings.uber_goal || '',
    brand_voice: brand ? 'BRAND VOICE:\n' + brand : '',
    url: url,
    title: parsed.title,
    meta_description: parsed.meta_description,
    h1s: parsed.h1s,
    word_count: String(parsed.word_count),
    missing_alt_count: String(parsed.missing_alt_count),
    internal_links: String(parsed.internal_links),
    external_links: String(parsed.external_links),
    body_excerpt: parsed.body_excerpt,
  });

  const { text: raw } = await complete(claudeKey, {
    system: 'You are SEO. Produce ONLY valid JSON. No prose before or after.',
    user: prompt,
    maxTokens: 1500,
  });
  const parsedReport = parseClaudeJson(raw) || {};
  const recs = Array.isArray(parsedReport.recommendations) ? parsedReport.recommendations : [];

  const sb = admin();
  if (parsedReport.summary) {
    await sb.from('events').insert({
      user_id: userId, agent: 'seo', kind: 'insight',
      title: 'SEO audit · ' + url,
      detail: String(parsedReport.summary).slice(0, 300),
      tag: 'seo',
    });
  }

  // Save each recommendation as a row, then send Telegram cards for the
  // auto-applicable ones (those with file/old_content/new_content set).
  // Non-applicable recs still get logged as events for context.
  let cardsSent = 0;
  for (const r of recs.slice(0, 8)) {
    const isAuto = !!(r.file && r.old_content && r.new_content);
    const { data: row, error: insErr } = await sb.from('seo_recommendations').insert({
      user_id: userId,
      page_url: url,
      kind: r.kind || 'fix',
      priority: r.priority || 'medium',
      suggestion: r.suggestion || '',
      auto_applicable: isAuto,
      file_path: r.file || null,
      old_content: r.old_content || null,
      new_content: r.new_content || null,
    }).select().single();

    if (insErr) {
      console.warn('[pa] seo rec insert failed:', insErr.message);
      continue;
    }

    if (isAuto) {
      try {
        await sendSeoCard(userId, row);
        cardsSent++;
      } catch (e) {
        console.warn('[pa] sendSeoCard failed:', e.message);
      }
    }
    await sb.from('events').insert({
      user_id: userId, agent: 'seo', kind: 'insight',
      title: '[' + (r.priority || 'medium').toUpperCase() + '] ' + (r.kind || 'fix'),
      detail: String(r.suggestion || '').slice(0, 400) + (isAuto ? ' [Telegram card sent]' : ''),
      tag: 'seo',
      ref_id: row.id,
    });
  }

  await logEvent(userId, 'seo', 'run', 'SEO done',
    recs.length + ' recs · ' + cardsSent + ' Telegram cards · ' +
    (parsedReport.scores ? JSON.stringify(parsedReport.scores) : ''), 'ok');

  return {
    recommendationsCount: recs.length,
    cardsSent,
    scores: parsedReport.scores || {},
    summary: parsedReport.summary || '',
  };
}

async function runAnalyst(userId, agent, settings) {
  const claudeKey = settings.claude_key_enc ? decrypt(settings.claude_key_enc) : null;
  if (!claudeKey) throw new Error('Claude API key not set in Settings');

  const sb = admin();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: drafts } = await sb
    .from('drafts')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', weekAgo);

  const posted   = (drafts || []).filter(d => d.stage === 'done').length;
  const approved = (drafts || []).filter(d => d.stage === 'done' || d.stage === 'publisher').length;
  const rejected = (drafts || []).filter(d => d.stage === 'rejected').length;
  const drafted  = (drafts || []).length;
  const approvalRate = drafted ? Math.round((approved / drafted) * 100) : 0;

  const catPerf = {};
  (drafts || []).forEach(d => {
    if (!d.category) return;
    if (!catPerf[d.category]) catPerf[d.category] = { count: 0, approved: 0 };
    catPerf[d.category].count++;
    if (d.stage === 'done' || d.stage === 'publisher') catPerf[d.category].approved++;
  });

  const prompt = substitute(agent.prompt_template || '', {
    'week_stats.posted': posted,
    'week_stats.approved': approved,
    'week_stats.rejected': rejected,
    'week_stats.drafted': drafted,
    'week_stats.approval_rate': approvalRate,
    category_perf: JSON.stringify(catPerf, null, 2),
    best: '(engagement tracking coming soon)',
    worst: '(engagement tracking coming soon)',
    voice_drift: '(coming soon)',
    uber_goal: settings.uber_goal || '',
  });

  const { text: raw } = await complete(claudeKey, {
    system: 'You are Analyst. Produce ONLY valid JSON.',
    user: prompt,
    maxTokens: 1000,
  });
  const report = parseClaudeJson(raw) || { summary: raw, recommendations: [] };

  await sb.from('analyst_reports').insert({
    user_id: userId,
    week_start: new Date(weekAgo).toISOString().slice(0, 10),
    posted, approved, rejected, drafted,
    approval_rate: approvalRate,
    recommendations: report.recommendations || [],
  });

  await logEvent(userId, 'analyst', 'report', 'Weekly report',
    (report.summary || '').slice(0, 160), 'report');

  return { report };
}

async function runGeneric(userId, agent, settings) {
  const claudeKey = settings.claude_key_enc ? decrypt(settings.claude_key_enc) : null;
  if (!claudeKey) throw new Error('Claude API key not set in Settings');
  const prompt = substitute(agent.prompt_template || '', { uber_goal: settings.uber_goal || '' });
  const { text } = await complete(claudeKey, { user: prompt, maxTokens: 600 });
  return { text };
}

// ─────────────────────────────────────────────────────────
// generateFromSeed — ambient-capture + URL-synthesis entry point
// ─────────────────────────────────────────────────────────
// One-shot draft generator seeded by the user's own text and/or a
// set of URLs (fetched + summarized). Produces a single draft in
// the chosen format: 'tweet' | 'thread' | 'longpost' | 'quote-tweet'.
//
// Different from runWriter (which pulls fresh HN/Reddit signals and
// makes 3 drafts). This path is driven by the user's explicit intent
// from the Telegram menu or prefix.
// ─────────────────────────────────────────────────────────
async function generateFromSeed(userId, opts) {
  opts = opts || {};
  const format = opts.format || 'tweet';           // tweet | thread | longpost | quote-tweet
  const seedText = String(opts.seed_text || '').trim();
  const urls = Array.isArray(opts.urls) ? opts.urls.slice(0, 5) : [];
  const t0 = Date.now();
  console.log('[pa] gen START format=' + format + ' urls=' + urls.length + ' seedLen=' + seedText.length);

  if (!seedText && urls.length === 0) {
    throw new Error('Need seed_text or urls');
  }

  const { fetchPageText } = require('./url-reader');
  const settings = await loadSettings(userId);
  const claudeKey = settings.claude_key_enc ? decrypt(settings.claude_key_enc) : null;
  if (!claudeKey) throw new Error('Claude API key not set in Settings');

  // Fetch URL content in parallel (was serial — one slow URL used to
  // block the whole run). Per-URL failures stay local.
  const sources = urls.length
    ? await Promise.all(urls.map(async function (u) {
        try {
          const page = await fetchPageText(u, { maxChars: 2000 });
          return page;
        } catch (e) {
          return { url: u, title: '', description: '', text: '[fetch failed: ' + e.message + ']' };
        }
      }))
    : [];
  console.log('[pa] gen urls fetched in', Date.now() - t0, 'ms');

  const sourcesBlock = sources.length
    ? sources.map(function (s, i) {
        return '### Source ' + (i + 1) + ': ' + s.url + '\n' +
          (s.title ? 'Title: ' + s.title + '\n' : '') +
          (s.description ? 'Description: ' + s.description + '\n' : '') +
          'Content: ' + s.text;
      }).join('\n\n')
    : '(no external sources — write from the seed text alone)';

  const brandVoice = settings.brand_voice || '';
  const voice = brandVoice ? 'BRAND VOICE (mirror this):\n' + brandVoice : '';

  // Pull the last 8 voice examples so the tone stays consistent.
  const sb = admin();
  const { data: inspirations } = await sb
    .from('voice_examples')
    .select('text')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(8);
  const voiceExamples = (inspirations || []).map(function (v) { return '- ' + v.text; }).join('\n');

  // Link library so Writer can cite real URLs
  const links = settings.reference_links || '';

  // Format-specific instructions + output schema
  let formatBlock;
  let outputSchema;
  if (format === 'thread') {
    formatBlock = 'FORMAT: Twitter thread of 3–5 connected tweets. First tweet hooks. Middle tweets deliver specifics. Last tweet summarizes or asks a question. Each tweet ≤ 280 chars.';
    outputSchema = '{\n  "text": "first tweet (the hook)",\n  "thread_parts": ["tweet 1 (same as text)", "tweet 2", "tweet 3", ...],\n  "text_linkedin": "the thread rewritten as a single 600-1400 char LinkedIn post — paragraphs, no arrow bullets, no hashtags, professional but not corporate",\n  "category": "builder-proof" | "point-of-view" | "teaching" | "personal",\n  "image_spec": {...same schema as Writer...}\n}';
  } else if (format === 'longpost') {
    formatBlock = 'FORMAT: LinkedIn long-form post, 1000–2500 characters. Structured with clear paragraphs, optional bullet lists, no hashtags. Opens with a hook, delivers specifics, ends with a single clear takeaway.';
    outputSchema = '{\n  "text": "the full LinkedIn post (1000-2500 chars)",\n  "category": "builder-proof" | "point-of-view" | "teaching" | "personal",\n  "image_spec": {...same schema as Writer...}\n}';
  } else if (format === 'quote-tweet') {
    formatBlock = 'FORMAT: Quote-tweet response. 1–3 sentences reacting to the source URL. The URL will be appended after your text so it renders as a quoted card. Do not include the URL in your output — just the reaction text.';
    outputSchema = '{\n  "text": "the 1-3 sentence reaction",\n  "category": "point-of-view",\n  "image_spec": {...optional...}\n}';
  } else {
    // single tweet
    formatBlock = 'FORMAT: One tweet, max 280 characters. Pick the format from the TEMPLATE LIBRARY that best fits the seed. Include image_spec.';
    outputSchema = '{\n  "text": "the tweet (Twitter-native, short, max 280 chars, arrow bullets OK)",\n  "text_linkedin": "the same idea rewritten as a 400-1200 char LinkedIn post — paragraphs, full sentences, no arrow bullets, no hashtags, professional but not corporate. Opens with a hook, body with specifics, closes with one takeaway.",\n  "template_name": "which template you used",\n  "category": "builder-proof" | "point-of-view" | "teaching" | "personal",\n  "image_spec": {...same schema as Writer...}\n}';
  }

  const templatesText = templatesBlock(settings.tweet_templates || '');

  const ownedPatterns = extractOwnedPatterns(settings);
  const ownedBlock = ownedPatterns.length > 0
    ? 'OWNED URLS / PROJECTS (these belong to the user — write about them in FIRST-PERSON or PROJECT-AS-SUBJECT, NEVER as "Someone built" / "A user shipped"):\n' +
      ownedPatterns.map(function (p) { return '  • ' + p; }).join('\n')
    : '';
  // Detect if any of the supplied URLs match an owned pattern → tweet should
  // use the user's voice mix.
  const seedTouchesOwned = ownedPatterns.some(function (pat) {
    return urls.some(function (u) { return u.toLowerCase().indexOf(pat) !== -1; }) ||
           seedText.toLowerCase().indexOf(pat) !== -1;
  });

  const promptParts = [
    'You are the user\'s content assistant. They sent you a seed + asked for ONE draft.',
    '',
    voice,
    voiceExamples ? 'VOICE EXAMPLES (match this rhythm):\n' + voiceExamples : '',
    links ? 'LINK LIBRARY:\n' + links : '',
    ownedBlock,
    seedTouchesOwned ? VOICE_MIX_RULES : '',
    'SEED TEXT FROM USER:\n' + (seedText || '(no seed — reply to sources only)'),
    '',
    'SOURCES:\n' + sourcesBlock,
    '',
    templatesText,
    '',
    formatBlock,
    '',
    'HARD RULES:',
    '- NEVER invent product, company, or project names. Only use names present in the SEED TEXT, SOURCES, LINK LIBRARY, or BRAND VOICE. If you\'re tempted to write a brandable name, you\'re hallucinating — stop.',
    '- NEVER invent facts — timeframes, durations, dates, sizes, outcomes, cohort numbers. If the seed text says "200+ students", don\'t add "in 2 years" unless "2 years" is also in the seed or brand context. Omit is always safer than guess.',
    '- Ground every claim in the seed text or the sources. No abstract metaphors.',
    seedTouchesOwned
      ? '- The SEED references the user\'s OWN project (matched against OWNED URLS list). Apply the VOICE MIX above — do NOT write "Someone built" or third-person framing.'
      : '- Write in the user\'s brand voice (see above) — short sentences, specific numbers, first-person, builder-first.',
    '- No hashtags. No "1/10" thread markers. No emojis unless the voice examples use them.',
    '- Return ONLY valid JSON matching this schema:',
    outputSchema,
  ].filter(Boolean);

  const prompt = promptParts.join('\n');
  console.log('[pa] gen calling Claude. promptLen=' + prompt.length);

  const { text: raw } = await complete(claudeKey, {
    system: 'You are Writer in focused mode. Produce ONLY valid JSON.',
    user: prompt,
    maxTokens: 3000,
  });
  console.log('[pa] gen Claude returned in', Date.now() - t0, 'ms · rawLen=' + (raw || '').length);

  const parsed = parseClaudeJson(raw);
  if (!parsed || !parsed.text) {
    console.warn('[pa] generateFromSeed parse FAILED. Raw (first 600):', (raw || '').slice(0, 600));
    console.warn('[pa] generateFromSeed parse FAILED. Raw (last 600):',  (raw || '').slice(-600));
    throw new Error('Writer returned invalid JSON. Raw length was ' + (raw || '').length + '. Check Vercel logs.');
  }

  const draftId = newDraftId();
  const category = parsed.category || 'point-of-view';

  // Pick an image spec with fallbacks in this order:
  //   1. Claude's image_spec if it's populated with actual content.
  //   2. Inferred spec from the tweet text (deterministic, always populated).
  // Promo content (URL + CTA phrasing) ALWAYS uses the inferred poster
  // spec — Claude has been known to pick a stat kind for promo tweets
  // and ship a half-empty card.
  const inferred = inferImageSpec({ text: parsed.text, category: category });
  const textLooksLikePromo = /https?:\/\//.test(parsed.text) ||
    /\b(register|join|sign up|apply|cohort|workshop|live program|registrations)\b/i.test(parsed.text);
  let imageSpec;
  if (textLooksLikePromo && inferred.kind === 'poster') {
    console.log('[pa] gen forcing poster kind for promo tweet');
    imageSpec = inferred;
  } else if (hasImageContent(parsed.image_spec)) {
    imageSpec = parsed.image_spec;
  } else {
    if (parsed.image_spec) {
      console.warn('[pa] gen Claude image_spec rejected · kind:', parsed.image_spec.kind,
        '· fields:', Object.keys(parsed.image_spec).join(','), '· using inferred');
    }
    imageSpec = inferred;
  }
  // Validate Claude's stat card: the number must appear as a standalone
  // token in the tweet text, not a substring. "0" in "200+" used to pass
  // the old .includes() check and we'd ship cards with a bogus "0".
  const statNumber = imageSpec && imageSpec.number ? String(imageSpec.number) : '';
  if (imageSpec && imageSpec.kind === 'stat' && statNumber) {
    // Compare against standalone tokens extracted from the tweet.
    const textTokens = (String(parsed.text).match(/\b(\$?\d{1,4}(?:,\d{3})*(?:\.\d+)?[+%]?|\d+x|\d+k|\d+m)\b/gi) || []);
    const valid = textTokens.some(function (t) {
      return t === statNumber || t.replace(/[+%]$/, '') === statNumber.replace(/[+%]$/, '');
    });
    if (!valid) {
      console.warn('[pa] stat number "' + statNumber + '" not a standalone token in text — using inferred spec. Tokens:', textTokens.join(','));
      imageSpec = inferred;
    }
  }
  // Ambient-capture drafts are grounded in the user's own text — trust the
  // deterministic inferImageSpec over Claude's guesses for card layout.
  // (Comment this line out if you want Claude's layout back.)
  // imageSpec = inferred;
  imageSpec = Object.assign({}, imageSpec, {
    brand_accent_hex: settings.brand_accent_hex || undefined,
    font_family: settings.image_font || 'Inter',
  });
  let imageSvg = null;
  try { imageSvg = renderSvg(imageSpec); } catch (e) { console.warn('[pa] image render failed for', draftId, e.message); }

  // Map format → draft_type
  const draftType = format === 'thread' ? 'thread' : format === 'longpost' ? 'longpost' : 'single';
  const threadParts = format === 'thread' && Array.isArray(parsed.thread_parts) ? parsed.thread_parts.slice(0, 5) : null;

  // Main text: for a thread, use the first tweet. For a longpost, the full body.
  const mainText = String(parsed.text || (threadParts && threadParts[0]) || '').slice(0, format === 'longpost' ? 3000 : 280);

  // For quote-tweets, append the first URL to the text so it renders as a card.
  const finalText = (format === 'quote-tweet' && urls[0])
    ? mainText + ' ' + urls[0]
    : mainText;

  // For longposts, text itself IS the LinkedIn-native body — don't duplicate
  // into text_linkedin. For other formats, use the model's text_linkedin if
  // given, otherwise leave null so Publisher falls back to text.
  const textLinkedIn = (draftType === 'longpost')
    ? null
    : (parsed.text_linkedin ? String(parsed.text_linkedin).slice(0, 3000) : null);

  const insertPayload = {
    id: draftId,
    user_id: userId,
    stage: 'messenger', // skip editor for seeded drafts — user already gated them
    category,
    text: finalText,
    text_linkedin: textLinkedIn,
    image_svg: imageSvg,
    image_spec: imageSpec,
    draft_type: draftType,
    thread_parts: threadParts,
    seed_text: seedText,
    source_urls: urls,
    platforms: ['twitter', 'linkedin'],
  };
  const { error: insertErr } = await sb.from('drafts').insert(insertPayload);
  if (insertErr) {
    console.error('[pa] gen draft INSERT FAILED:', insertErr.message, '· draftId:', draftId);
    // Common: text_linkedin column missing → migration not yet run.
    // Retry without columns added in recent migrations so something lands.
    if (insertErr.message && insertErr.message.toLowerCase().indexOf('column') !== -1) {
      console.warn('[pa] gen retrying insert without recent columns');
      const safe = Object.assign({}, insertPayload);
      delete safe.text_linkedin;
      delete safe.draft_type;
      delete safe.thread_parts;
      delete safe.seed_text;
      delete safe.source_urls;
      delete safe.platforms;
      const { error: retryErr } = await sb.from('drafts').insert(safe);
      if (retryErr) throw new Error('DB insert failed (even after fallback): ' + retryErr.message);
    } else {
      throw new Error('DB insert failed: ' + insertErr.message);
    }
  }
  console.log('[pa] gen draft inserted in', Date.now() - t0, 'ms · id:', draftId);

  await logEvent(userId, 'writer', 'draft', `Drafted ${draftId} (${format})`,
    '[' + (parsed.template_name || format) + '] ' + mainText.slice(0, 100),
    category, draftId);

  return { id: draftId, draft_type: draftType, text: finalText, thread_parts: threadParts };
}

module.exports = {
  runAgent,
  generateFromSeed,
  logEvent,
  substitute,
  inferImageSpec,
  paletteFor,
  iconFor,
};
