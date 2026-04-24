// ─────────────────────────────────────────────────────────
// image.js — generate branded tweet cards as SVG/PNG
// ─────────────────────────────────────────────────────────
// Produces 1200x675 (16:9) images with:
//   - Organic blob shapes as background
//   - Lucide icon (inlined SVG paths)
//   - DM Serif Display heading + Open Sans body text
//   - Indigo accent (#4F46E5) branded gradient
//
// Card kinds:
//   'stat'       — big number + label (for numbers: 15+, 200+, $10/month)
//   'quote'      — pull quote with attribution
//   'milestone'  — launch/announcement card
//   'lesson'     — teaching card with short tip
//
// Returns raw SVG as a string. The Publisher agent converts
// to PNG via @resvg/resvg-js just before Twitter upload.
// ─────────────────────────────────────────────────────────

const LUCIDE_ICONS = {
  // Core set — hardcoded from lucide-icons.com
  // All paths are at viewBox "0 0 24 24", stroke-width 1.5
  rocket: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0 M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  code: 'm18 16 4-4-4-4 M6 8l-4 4 4 4 M14.5 4l-5 16',
  brain: 'M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z',
  trending: 'M22 7 13.5 15.5 8.5 10.5 2 17 M16 7h6v6',
  sparkles: 'm12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z M5 3v4 M3 5h4 M19 17v4 M17 19h4',
  target: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0z M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  'graduation-cap': 'M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z M22 10v6 M6 12.5V16a6 3 0 0 0 12 0v-3.5',
  hammer: 'm15 12-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9 m17.64 15L22 10.64 m7 5c-1.5-1.5-3-1.5-3-1.5s1-1 1-2 .5-2.5.5-2.5s2.5-.5 3-.5c1-.5 1.5-1.5 2.5-1.5s2.5-.5 3.5-1.5',
  lightbulb: 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5 M9 18h6 M10 22h4',
  palette: 'M12 2a10 10 0 1 0 9.5 13 M8 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M12 5a7 7 0 0 1 7 7 M16 9h.01 M19 13h.01',
  'message-circle': 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z',
  heart: 'm19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
  bolt: 'm13 2-3 7h5l-3 7',
  mail: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z m22 6-10 5L2 6',
  check: 'M20 6 9 17l-5-5',
  arrow: 'M5 12h14 m12 5 7-7-7-7',
};

// ─────────────────────────────────────────────────────────
// Card palettes — rotate for variety
// ─────────────────────────────────────────────────────────
const PALETTES = {
  indigo: {
    bg: '#ffffff',
    accent: '#4F46E5',
    accent2: '#818CF8',
    ink: '#1a1a1a',
    subtle: '#eef2ff',
    blob1: '#4F46E5',
    blob2: '#F59E0B',
  },
  emerald: {
    bg: '#ffffff',
    accent: '#059669',
    accent2: '#34D399',
    ink: '#1a1a1a',
    subtle: '#ecfdf5',
    blob1: '#059669',
    blob2: '#6366F1',
  },
  orange: {
    bg: '#ffffff',
    accent: '#EA580C',
    accent2: '#FB923C',
    ink: '#1a1a1a',
    subtle: '#fff7ed',
    blob1: '#EA580C',
    blob2: '#8B5CF6',
  },
  dark: {
    bg: '#0F0F10',
    accent: '#818CF8',
    accent2: '#A78BFA',
    ink: '#F5F5F5',
    subtle: '#1E1B4B',
    blob1: '#4F46E5',
    blob2: '#F59E0B',
  },
};

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap text into lines of approx `maxChars` width.
 * SVG doesn't auto-wrap — we emit explicit <tspan> per line.
 */
function wrapText(text, maxChars) {
  if (!text) return [''];
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (next.length > maxChars) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Build an inline Lucide icon SVG as a path-group. */
function iconPath(name, size = 80, color = '#ffffff', strokeWidth = 1.75) {
  const d = LUCIDE_ICONS[name] || LUCIDE_ICONS.sparkles;
  // Lucide icons can have multiple subpaths separated by uppercase M/m;
  // the "path" data string we store concatenates them. SVG handles this fine.
  return `<svg x="0" y="0" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg">
      <path d="${d}"/>
  </svg>`;
}

/** Random organic blob (viewBox 0-1). */
function organicBlob(id, cx, cy, radius, color, opacity = 0.12, seed = 0) {
  const points = 8;
  const coords = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const jitter = 0.75 + (Math.sin(seed + i * 1.7) * 0.25 + 0.25);
    const r = radius * jitter;
    coords.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    });
  }
  let path = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < points; i++) {
    const a = coords[i];
    const b = coords[(i + 1) % points];
    const c = coords[(i + 2) % points];
    const midX = (b.x + c.x) / 2;
    const midY = (b.y + c.y) / 2;
    path += ` Q ${b.x} ${b.y} ${midX} ${midY}`;
  }
  path += ' Z';
  return `<path id="${id}" d="${path}" fill="${color}" opacity="${opacity}" />`;
}

// ─────────────────────────────────────────────────────────
// Card templates
// ─────────────────────────────────────────────────────────

/**
 * STAT card — big number centered, icon above, label below.
 * Options: { number, label, icon, palette }
 */
function statCard(opts) {
  const FF = opts.font_family || 'Inter';
  const p = PALETTES[opts.palette || 'indigo'];
  const number = esc(opts.number || '—');
  // Label: short noun only, UPPERCASE with wide tracking, like a stats
  // strip ("15+ YEARS", "200+ USERS"). No full sentences.
  const label = esc(String(opts.label || '').split(/\s+/).slice(0, 2).join(' ').toUpperCase());
  const tagline = esc(opts.tagline || '');
  const iconName = opts.icon || 'sparkles';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
    <defs>
      <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${p.bg}"/>
        <stop offset="100%" stop-color="${p.subtle}"/>
      </linearGradient>
      <filter id="blur-soft" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="40"/>
      </filter>
    </defs>
    <rect width="1200" height="675" fill="url(#bg-grad)"/>
    <g filter="url(#blur-soft)">
      ${organicBlob('b1', 950, 120, 220, p.blob1, 0.22, 1)}
      ${organicBlob('b2', 150, 560, 260, p.blob2, 0.18, 5)}
      ${organicBlob('b3', 600, 340, 180, p.accent, 0.10, 3)}
    </g>
    <g transform="translate(72, 72)">
      <rect x="0" y="0" width="96" height="96" rx="24" fill="${p.accent}"/>
      <g transform="translate(8, 8)">
        ${iconPath(iconName, 80, '#ffffff', 1.75)}
      </g>
    </g>
    <!-- Big number: Inter Black (900), tight tracking -->
    <text x="600" y="380" text-anchor="middle"
      font-family="${FF}" font-size="280" font-weight="900"
      fill="${p.ink}" letter-spacing="-0.06em">${number}</text>
    <!-- Label: Inter Bold (700), UPPERCASE, wide tracking -->
    <text x="600" y="460" text-anchor="middle"
      font-family="${FF}" font-size="26" font-weight="700"
      fill="${p.ink}" letter-spacing="0.16em">${label}</text>
  </svg>`;
}

/**
 * QUOTE card — large pull-quote with author attribution.
 * Options: { quote, author, palette }
 */
function quoteCard(opts) {
  const FF = opts.font_family || 'Inter';
  const p = PALETTES[opts.palette || 'indigo'];
  // Quote is wrapped + escaped per-tspan below. Pre-escaping here would
  // cause double-escape (`isn't` → `isn&#39;t` → `isn&amp;#39;t` → renders
  // literally as `isn&#39;t` in the PNG).
  const quote = opts.quote || '';
  const author = esc(opts.author || '');
  const lines = wrapText(quote, 32);

  const totalHeight = lines.length * 74;
  const startY = 340 - totalHeight / 2 + 60;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
    <defs>
      <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${p.bg}"/>
        <stop offset="100%" stop-color="${p.subtle}"/>
      </linearGradient>
      <filter id="blur-soft" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="36"/>
      </filter>
    </defs>

    <rect width="1200" height="675" fill="url(#bg-grad)"/>

    <!-- Organic blobs -->
    <g filter="url(#blur-soft)">
      ${organicBlob('b1', 1000, 520, 220, p.blob1, 0.20, 2)}
      ${organicBlob('b2', 180, 150, 180, p.blob2, 0.16, 6)}
    </g>

    <!-- Giant quote mark: Inter Black -->
    <text x="100" y="180"
      font-family="${FF}" font-size="280" font-weight="900"
      fill="${p.accent}" opacity="0.22">&#8220;</text>

    <!-- Quote text: Inter SemiBold (600), near-display size, sentence case -->
    <text x="100" y="${startY}"
      font-family="${FF}" font-size="56" font-weight="600"
      fill="${p.ink}" letter-spacing="-0.02em">
      ${lines.map((l, i) => `<tspan x="100" dy="${i === 0 ? 0 : 72}">${esc(l)}</tspan>`).join('')}
    </text>

    <!-- Author: Inter Bold (700), UPPERCASE, wide tracking -->
    <g transform="translate(100, 580)">
      <rect x="0" y="0" width="48" height="4" rx="2" fill="${p.accent}"/>
      <text x="64" y="18"
        font-family="${FF}" font-size="20" font-weight="700"
        fill="${p.ink}" letter-spacing="0.14em">${author.toUpperCase()}</text>
    </g>
  </svg>`;
}

/**
 * MILESTONE card — launch/announcement card.
 * Options: { title, subtitle, icon, palette }
 */
function milestoneCard(opts) {
  const FF = opts.font_family || 'Inter';
  const p = PALETTES[opts.palette || 'indigo'];
  // title + subtitle are wrapped + escaped per-tspan below. Pre-escaping
  // here would cause double-escape — see quoteCard for the same fix.
  const title = opts.title || 'Shipped';
  const subtitle = opts.subtitle || '';
  const eyebrow = esc(opts.eyebrow || 'Just Shipped');
  const iconName = opts.icon || 'rocket';
  const titleLines = wrapText(title, 20);
  const subLines = wrapText(subtitle, 55);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
    <defs>
      <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${p.bg}"/>
        <stop offset="100%" stop-color="${p.subtle}"/>
      </linearGradient>
      <filter id="blur-soft" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="40"/>
      </filter>
    </defs>

    <rect width="1200" height="675" fill="url(#bg-grad)"/>

    <g filter="url(#blur-soft)">
      ${organicBlob('b1', 1050, 180, 240, p.blob1, 0.22, 4)}
      ${organicBlob('b2', 100, 600, 220, p.blob2, 0.16, 7)}
      ${organicBlob('b3', 700, 500, 160, p.accent, 0.10, 2)}
    </g>

    <!-- Icon (large, top-right) -->
    <g transform="translate(980, 80)">
      <rect x="0" y="0" width="140" height="140" rx="32" fill="${p.accent}" opacity="0.95"/>
      <g transform="translate(10, 10)">
        ${iconPath(iconName, 120, '#ffffff', 1.6)}
      </g>
    </g>

    <!-- Eyebrow: Inter Bold (700), UPPERCASE, wide tracking -->
    <g transform="translate(100, 120)">
      <rect x="0" y="2" width="12" height="12" rx="6" fill="${p.accent}"/>
      <text x="24" y="13"
        font-family="${FF}" font-size="17" font-weight="700"
        fill="${p.accent}" letter-spacing="0.18em">${eyebrow.toUpperCase()}</text>
    </g>

    <!-- Title: Inter Black (900), sentence case, tight tracking -->
    <text x="100" y="260"
      font-family="${FF}" font-size="88" font-weight="900"
      fill="${p.ink}" letter-spacing="-0.04em">
      ${titleLines.map((l, i) => `<tspan x="100" dy="${i === 0 ? 0 : 96}">${esc(l)}</tspan>`).join('')}
    </text>

    <!-- Subtitle: Inter Medium (500), sentence case, relaxed tracking -->
    <text x="100" y="${260 + titleLines.length * 96 + 48}"
      font-family="${FF}" font-size="26" font-weight="500"
      fill="${p.ink}" opacity="0.72" letter-spacing="-0.005em">
      ${subLines.map((l, i) => `<tspan x="100" dy="${i === 0 ? 0 : 38}">${esc(l)}</tspan>`).join('')}
    </text>
  </svg>`;
}

/**
 * LESSON card — short teaching/insight post.
 * Options: { eyebrow, body, icon, palette }
 */
function lessonCard(opts) {
  const FF = opts.font_family || 'Inter';
  const p = PALETTES[opts.palette || 'indigo'];
  // Eyebrow intentionally not rendered. The auto-fills ("TAKE",
  // "LESSON", "BUILD LOG") sat above the big body and felt redundant
  // — the icon already signals the kind. Field kept on the spec for
  // backward-compat; simply unused at render time.
  // Body is wrapped + escaped per-tspan below. Pre-escaping here would
  // cause double-escape — produced "isn&#39;t" rendered literally on
  // posters with apostrophes in the source text.
  const body = opts.body || '';
  const iconName = opts.icon || 'lightbulb';
  const bodyLines = wrapText(body, 28);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
    <defs>
      <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${p.bg}"/>
        <stop offset="100%" stop-color="${p.subtle}"/>
      </linearGradient>
      <filter id="blur-soft" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="40"/>
      </filter>
    </defs>

    <rect width="1200" height="675" fill="url(#bg-grad)"/>

    <g filter="url(#blur-soft)">
      ${organicBlob('b1', 180, 140, 200, p.blob1, 0.20, 3)}
      ${organicBlob('b2', 1050, 500, 280, p.blob2, 0.16, 8)}
    </g>

    <!-- Icon (left, large) -->
    <g transform="translate(100, 80)">
      <rect x="0" y="0" width="120" height="120" rx="28" fill="${p.accent}"/>
      <g transform="translate(10, 10)">
        ${iconPath(iconName, 100, '#ffffff', 1.7)}
      </g>
    </g>

    <!-- Body: Inter SemiBold (600), sentence case, tight tracking
         (eyebrow intentionally omitted — see comment in body declaration) -->
    <text x="100" y="280"
      font-family="${FF}" font-size="60" font-weight="600"
      fill="${p.ink}" letter-spacing="-0.025em">
      ${bodyLines.map((l, i) => `<tspan x="100" dy="${i === 0 ? 0 : 74}">${esc(l)}</tspan>`).join('')}
    </text>
  </svg>`;
}

// ─────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────

/**
 * Build an SVG card from a prompt object.
 * @param {object} spec
 *   - kind:    'stat' | 'quote' | 'milestone' | 'lesson'
 *   - palette: 'indigo' | 'emerald' | 'orange' | 'dark'
 *   - icon:    name from LUCIDE_ICONS (rocket, zap, code, brain, etc.)
 *   - number, label, tagline                       (stat)
 *   - quote, author                                (quote)
 *   - title, subtitle, eyebrow                     (milestone)
 *   - eyebrow, body                                (lesson)
 * @returns {string} SVG markup (1200x675, 16:9)
 */
// If the draft spec carries a brand_accent_hex (injected server-side from
// settings), overlay it onto the chosen palette so every kind — stat,
// lesson, poster, quote, milestone — uses the user's color. The palette
// structure provides bg/ink/subtle baseline; accent + blob1 become the
// user's color, blob2 stays as the palette's contrast color.
function applyBrandAccent(spec) {
  if (!spec || !spec.brand_accent_hex) return spec;
  const name = spec.palette || 'indigo';
  const base = PALETTES[name] || PALETTES.indigo;
  const accent = spec.brand_accent_hex;
  // Mutate a copy; don't touch PALETTES globals.
  const overridden = Object.assign({}, base, {
    accent,
    accent2: accent,       // keep single-tone branding clean
    blob1: accent,
  });
  PALETTES.__brand = overridden;
  return Object.assign({}, spec, { palette: '__brand' });
}

function renderSvg(spec) {
  spec = applyBrandAccent(spec);
  const kind = spec.kind || 'stat';
  switch (kind) {
    case 'quote':     return quoteCard(spec);
    case 'milestone': return milestoneCard(spec);
    case 'lesson':    return lessonCard(spec);
    case 'poster':    return posterCard(spec);
    case 'stat':
    default:          return statCard(spec);
  }
}

// Ordered list of poster variants — re-render cycles through these.
// Each is a genuinely different design language (not just layout):
//   classic    — dark bg + red accent + Inter 900 (event poster)
//   editorial  — cream bg + Lora serif + small spaced eyebrow (pull-quote)
//   split      — 40/60 accent-color block | white panel (magazine spread)
//   gradient   — diagonal dark→accent gradient, white sans (app hero)
//   studio     — soft pastel blobs + accent icon tile + dot-eyebrow +
//                bold black sans headline (shipping-announcement energy)
// Exported so the UI + regenerate endpoint can read the count and
// compute the "Style N/total" label without hardcoding.
const POSTER_VARIANTS = ['classic', 'editorial', 'split', 'gradient', 'studio'];

/**
 * Poster card dispatcher — picks one of the poster design languages
 * from opts.variant. Defaults to 'classic' so (a) specs authored
 * before variants existed still render the original look, and
 * (b) legacy variant values from the earlier layout-only iteration
 * ('minimalist', 'typographic') fall through safely.
 */
function posterCard(opts) {
  const variant = opts && opts.variant;
  switch (variant) {
    case 'editorial':   return posterCard_editorial(opts);
    case 'split':       return posterCard_split(opts);
    case 'gradient':    return posterCard_gradient(opts);
    case 'studio':      return posterCard_studio(opts);
    case 'classic':
    default:            return posterCard_classic(opts);
  }
}

/**
 * Poster variant: CLASSIC — bold typographic event/promo design.
 * White headline on near-black, one word in red, gray sub,
 * optional bullet list, red CTA bar at the bottom.
 *
 * spec:
 *   eyebrow     — small red uppercase label ("2-DAY LIVE PROGRAM")
 *   headline    — big white headline ("Stop designing mockups. Start shipping products.")
 *   accent_word — the ONE word in the headline to render in red
 *   sub         — gray subtitle paragraph
 *   bullets     — array of 2-4 short bullets
 *   cta_label   — red bar left text ("Register Now")
 *   cta_url     — red bar right text ("yourdomain.com/signup")
 *   byline      — small gray line at the very bottom
 */
function posterCard_classic(opts) {
  const FF = opts.font_family || 'Inter';
  const eyebrow    = esc(opts.eyebrow     || '');
  const headline   = opts.headline        || '';
  const accentWord = opts.accent_word     || '';
  const sub        = opts.sub             || '';
  const bullets    = Array.isArray(opts.bullets) ? opts.bullets.slice(0, 3) : [];
  const ctaLabel   = esc(opts.cta_label   || '');
  const ctaUrl     = esc(opts.cta_url     || '');
  const byline     = esc(opts.byline      || '');

  const BG     = '#0A0A0A';
  const INK    = '#FFFFFF';
  const GRAY   = '#9CA3AF';
  const RED    = opts.brand_accent_hex || '#E11D48';

  // Fixed layout anchors — CTA bar always sits at y=1040 so content NEVER
  // overflows the bottom of the 1200×1200 canvas.
  const CONTENT_TOP    = 260;   // where headline starts
  const CONTENT_BOTTOM = 1000;  // ~40px above the CTA bar
  const CTA_Y          = 1040;

  // Wrap helper: greedy line-break at a max char count.
  function wrap(text, maxChars) {
    if (!text) return [];
    const words = String(text).split(/\s+/);
    const out = [];
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > maxChars && line) { out.push(line.trim()); line = w; }
      else { line = (line + ' ' + w).trim(); }
    }
    if (line) out.push(line);
    return out;
  }

  // HEADLINE — cap at 3 lines, tighten wrap if longer.
  let headlineLines = wrap(headline, 20);
  if (headlineLines.length > 3) headlineLines = wrap(headline, 28).slice(0, 3);
  const accentLC = accentWord.toLowerCase().replace(/[^a-z0-9]/g, '');

  const headlineSvg = headlineLines.map(function (ln, i) {
    const y = CONTENT_TOP + 80 + i * 90;
    const parts = ln.split(/\s+/).map(function (w) {
      const norm = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      return { w: w, accent: norm === accentLC && !!accentLC };
    });
    const tspans = parts.map(function (p, idx) {
      const prefix = idx === 0 ? '' : ' ';
      const fill = p.accent ? RED : INK;
      return '<tspan fill="' + fill + '">' + esc(prefix + p.w) + '</tspan>';
    }).join('');
    return '<text x="80" y="' + y + '" font-family="' + FF + '" font-weight="900" font-size="76" letter-spacing="-0.04em">' + tspans + '</text>';
  }).join('');

  // SUB — always wrap into tspans (never overflow right edge).
  const headlineEndY = CONTENT_TOP + 80 + headlineLines.length * 90 + 30;
  const subLines = wrap(sub, 44).slice(0, 3);
  const subSvg = subLines.map(function (ln, i) {
    return '<text x="80" y="' + (headlineEndY + i * 36) + '" font-family="' + FF + '" font-weight="500" font-size="24" fill="' + GRAY + '">' + esc(ln) + '</text>';
  }).join('');

  // BULLETS — sit below the sub. Skip any that would overflow CTA_Y - 40.
  const bulletStart = headlineEndY + subLines.length * 36 + 24;
  const bulletsSvg = bullets.map(function (b, i) {
    const y = bulletStart + i * 44;
    if (y > CTA_Y - 30) return '';  // guard against overflow
    return '<g transform="translate(80 ' + y + ')">' +
      '<circle cx="14" cy="-10" r="16" fill="#3F0D16"/>' +
      '<path d="M7 -12 l5 4 l10 -10" stroke="' + RED + '" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<text x="48" y="-4" font-family="' + FF + '" font-weight="700" font-size="20" fill="' + INK + '">' + esc(b) + '</text>' +
    '</g>';
  }).filter(Boolean).join('');

  // CTA — fixed y=1040, always visible.
  const hasCta = ctaLabel || ctaUrl;
  // URL might be longer than available space — truncate at ~44 chars visually.
  const shownUrl = ctaUrl.length > 44 ? ctaUrl.slice(0, 43) + '…' : ctaUrl;
  const ctaSvg = hasCta
    ? '<rect x="60" y="' + CTA_Y + '" width="1080" height="96" rx="8" fill="' + RED + '"/>' +
      '<text x="96" y="' + (CTA_Y + 58) + '" font-family="' + FF + '" font-weight="900" font-size="28" fill="' + INK + '">' + (ctaLabel ? ctaLabel.toUpperCase() : 'VIEW') + '</text>' +
      (shownUrl ? '<text x="1104" y="' + (CTA_Y + 58) + '" font-family="' + FF + '" font-weight="600" font-size="20" fill="' + INK + '" text-anchor="end">' + shownUrl + '</text>' : '')
    : '';

  // Byline intentionally not rendered — product decision to keep the
  // poster content-only, no name attribution. Field kept on the spec
  // for backward-compat; simply unused here. (Same in editorial.)
  const bylineSvg = '';

  return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">' +
    '<rect width="1200" height="1200" fill="' + BG + '"/>' +
    '<rect x="0" y="0" width="1200" height="8" fill="' + RED + '"/>' +
    (eyebrow ? '<text x="80" y="200" font-family="' + FF + '" font-weight="700" font-size="20" letter-spacing="4" fill="' + RED + '">' + eyebrow.toUpperCase() + '</text>' : '') +
    headlineSvg +
    subSvg +
    bulletsSvg +
    ctaSvg +
    bylineSvg +
  '</svg>';
}

/**
 * Compose a richer sub for poster variants that don't render the
 * bullets[] field (editorial, split, gradient, studio all use sub
 * but have no bullet list). Folds the first 1–3 bullets into the
 * sub so those variants don't leave a big empty middle when the
 * source text had rich content. Capped at `maxLen` chars so it
 * still fits the variant's sub area.
 *
 * Called by each of those variants' renderers before the sub is
 * wrapped and drawn. posterCard_classic (which DOES render bullets)
 * does not call this — its bullets stay as bullets.
 */
function composeRichSub(sub, bullets, maxLen) {
  const max = maxLen || 180;
  const base = String(sub || '').trim();
  if (!Array.isArray(bullets) || bullets.length === 0) return base;
  // Avoid duplicating the sub if it already matches a bullet.
  const cleanBullets = bullets
    .map(function (b) { return String(b || '').trim(); })
    .filter(function (b) { return b && b !== base; });
  if (cleanBullets.length === 0) return base;
  // Join "sub. bullet1. bullet2. bullet3." with reasonable punctuation.
  const pieces = base ? [base].concat(cleanBullets) : cleanBullets.slice();
  let out = '';
  for (const p of pieces) {
    const next = (out ? out + ' ' : '') + p.replace(/[.!?]+$/, '') + '.';
    if (next.length > max) break;
    out = next;
  }
  return out || base;
}

/**
 * Shared word-wrapping helper used by the design-language renderers.
 * Greedy break at `maxChars`; returns an array of lines.
 */
function wrapLines(text, maxChars) {
  if (!text) return [];
  const words = String(text).split(/\s+/);
  const out = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars && line) { out.push(line.trim()); line = w; }
    else { line = (line + ' ' + w).trim(); }
  }
  if (line) out.push(line);
  return out;
}

/**
 * Poster variant: EDITORIAL — cream bg, Lora serif, small spaced eyebrow.
 * Pull-quote / magazine energy. Good for teaching, reflections, thoughtful
 * content. No bullets; optional em-dash byline; inline CTA at bottom.
 */
function posterCard_editorial(opts) {
  const eyebrow    = esc(opts.eyebrow     || '');
  const headline   = opts.headline        || '';
  const accentWord = opts.accent_word     || '';
  const sub        = opts.sub             || '';
  const ctaLabel   = esc(opts.cta_label   || '');
  const ctaUrl     = esc(opts.cta_url     || '');
  const byline     = esc(opts.byline      || '');

  const BG     = '#FAF7F0';                         // warm cream
  const INK    = '#1A1A1A';
  const GRAY   = '#57504A';                         // editorial muted
  const SOFT   = '#8A8278';                         // even softer
  const ACCENT = opts.brand_accent_hex || '#E11D48';

  // Lora is bundled in lib/pa/fonts/ as a variable TTF — resvg will pick
  // the right weight via font-weight attribute.
  const SERIF  = 'Lora';
  const SANS   = 'Inter';

  // Spaced-caps eyebrow: "N E W · O P E N" look. Just add extra space
  // between every letter of the raw eyebrow string.
  const spacedEyebrow = eyebrow
    ? eyebrow.toUpperCase().split('').join(' ')
    : '';

  const accentLC = accentWord.toLowerCase().replace(/[^a-z0-9]/g, '');
  let headlineLines = wrapLines(headline, 18);
  if (headlineLines.length > 4) headlineLines = wrapLines(headline, 24).slice(0, 4);
  const H_SIZE = headlineLines.length <= 3 ? 92 : 78;
  const H_GAP  = Math.round(H_SIZE * 1.1);
  const H_TOP  = 300;

  const headlineSvg = headlineLines.map(function (ln, i) {
    const y = H_TOP + i * H_GAP;
    // Highlight accent_word in the brand accent to keep continuity with other variants.
    const parts = ln.split(/\s+/).map(function (w) {
      const norm = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      return { w: w, accent: norm === accentLC && !!accentLC };
    });
    const tspans = parts.map(function (p, idx) {
      const prefix = idx === 0 ? '' : ' ';
      const fill = p.accent ? ACCENT : INK;
      return '<tspan fill="' + fill + '">' + esc(prefix + p.w) + '</tspan>';
    }).join('');
    return '<text x="80" y="' + y + '" font-family="' + SERIF + '" font-weight="700" font-size="' + H_SIZE + '" letter-spacing="-0.02em">' + tspans + '</text>';
  }).join('');

  const headlineBottom = H_TOP + headlineLines.length * H_GAP;
  // Byline intentionally not rendered — see posterCard_classic.
  const subTop   = headlineBottom + 56;
  // Editorial doesn't render bullets — fold them into the sub so rich
  // source text (e.g. "One command. Ten agents debating.") fills the
  // middle instead of leaving it empty.
  const richSub  = composeRichSub(sub, opts.bullets, 150);
  const subLines = wrapLines(richSub, 50).slice(0, 3);
  const bylineSvg = '';

  const subSvg = subLines.map(function (ln, i) {
    return '<text x="80" y="' + (subTop + i * 38) + '" font-family="' + SERIF + '" font-weight="400" font-style="italic" font-size="26" fill="' + GRAY + '">' + esc(ln) + '</text>';
  }).join('');

  // Inline CTA at the bottom-left, no colored bar. Thin accent hairline
  // sits above it for a editorial-column feel.
  const shownUrl = ctaUrl.length > 48 ? ctaUrl.slice(0, 47) + '…' : ctaUrl;
  const ctaY     = 1140;
  const hairY    = ctaY - 48;
  const ctaText  = (ctaLabel ? ctaLabel : 'View') + (shownUrl ? '  →  ' + shownUrl : '');

  return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">' +
    '<rect width="1200" height="1200" fill="' + BG + '"/>' +
    (spacedEyebrow ? '<text x="80" y="180" font-family="' + SANS + '" font-weight="600" font-size="16" letter-spacing="0.3em" fill="' + SOFT + '">' + esc(spacedEyebrow) + '</text>' : '') +
    headlineSvg +
    bylineSvg +
    subSvg +
    '<line x1="80" y1="' + hairY + '" x2="200" y2="' + hairY + '" stroke="' + ACCENT + '" stroke-width="2"/>' +
    '<text x="80" y="' + ctaY + '" font-family="' + SANS + '" font-weight="600" font-size="22" fill="' + INK + '">' + esc(ctaText) + '</text>' +
  '</svg>';
}

/**
 * Poster variant: SPLIT — 40/60 accent-color block | white panel.
 * Magazine-spread energy. Left block shows a big white wordmark from
 * accent_word or the first headline word. Right panel carries the
 * actual headline, sub, and inline CTA in dark ink on white.
 */
function posterCard_split(opts) {
  const FF = opts.font_family || 'Inter';
  const eyebrow    = esc(opts.eyebrow     || '');
  const headline   = opts.headline        || '';
  const accentWord = opts.accent_word     || '';
  const sub        = opts.sub             || '';
  const ctaLabel   = esc(opts.cta_label   || '');
  const ctaUrl     = esc(opts.cta_url     || '');

  const ACCENT = opts.brand_accent_hex || '#E11D48';
  const INK    = '#1A1A1A';
  const GRAY   = '#57504A';
  const WHITE  = '#FFFFFF';
  const SPLIT_X = 480;                              // 40% of 1200

  // Left wordmark: prefer accent_word, fall back to first headline word.
  const firstWord = String(headline || '').split(/\s+/).filter(Boolean)[0] || 'New';
  const wordmark = (accentWord && accentWord.trim() ? accentWord : firstWord).toUpperCase();
  // Cap wordmark length so very long words don't overflow the left block.
  const wordmarkFit = wordmark.length > 10 ? wordmark.slice(0, 10) : wordmark;
  const WM_SIZE = wordmarkFit.length <= 5 ? 128 : (wordmarkFit.length <= 7 ? 100 : 80);

  // Right panel headline, wrapped tight.
  let headlineLines = wrapLines(headline, 16);
  if (headlineLines.length > 4) headlineLines = wrapLines(headline, 22).slice(0, 4);
  const H_SIZE = headlineLines.length <= 3 ? 64 : 56;
  const H_GAP  = Math.round(H_SIZE * 1.08);
  const H_TOP  = 320;
  const H_LEFT = SPLIT_X + 64;                      // x=544

  const headlineSvg = headlineLines.map(function (ln, i) {
    const y = H_TOP + i * H_GAP;
    return '<text x="' + H_LEFT + '" y="' + y + '" font-family="' + FF + '" font-weight="900" font-size="' + H_SIZE + '" letter-spacing="-0.03em" fill="' + INK + '">' + esc(ln) + '</text>';
  }).join('');

  const subTop   = H_TOP + headlineLines.length * H_GAP + 40;
  // Split variant doesn't render bullets — fold them into the sub.
  const richSub  = composeRichSub(sub, opts.bullets, 120);
  const subLines = wrapLines(richSub, 40).slice(0, 3);
  const subSvg = subLines.map(function (ln, i) {
    return '<text x="' + H_LEFT + '" y="' + (subTop + i * 34) + '" font-family="' + FF + '" font-weight="500" font-size="22" fill="' + GRAY + '">' + esc(ln) + '</text>';
  }).join('');

  // Inline CTA at the bottom-right of the right panel.
  const shownUrl = ctaUrl.length > 40 ? ctaUrl.slice(0, 39) + '…' : ctaUrl;
  const ctaY     = 1140;
  const ctaRuleY = ctaY - 44;
  const ctaText  = (ctaLabel ? ctaLabel.toUpperCase() : 'VIEW') + (shownUrl ? '  →  ' + shownUrl : '');

  return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">' +
    // Right panel — white behind (fills full canvas, left will overlay).
    '<rect width="1200" height="1200" fill="' + WHITE + '"/>' +
    // Left block — solid accent.
    '<rect x="0" y="0" width="' + SPLIT_X + '" height="1200" fill="' + ACCENT + '"/>' +
    // Left wordmark — white on accent, centered in the left block.
    '<text x="' + (SPLIT_X / 2) + '" y="' + 620 + '" font-family="' + FF + '" font-weight="900" font-size="' + WM_SIZE + '" letter-spacing="-0.04em" fill="' + WHITE + '" text-anchor="middle">' + esc(wordmarkFit) + '</text>' +
    // Right: small eyebrow in accent color.
    (eyebrow ? '<text x="' + H_LEFT + '" y="220" font-family="' + FF + '" font-weight="700" font-size="18" letter-spacing="0.2em" fill="' + ACCENT + '">' + eyebrow.toUpperCase() + '</text>' : '') +
    headlineSvg +
    subSvg +
    // Hairline + inline CTA.
    '<line x1="' + H_LEFT + '" y1="' + ctaRuleY + '" x2="1120" y2="' + ctaRuleY + '" stroke="#E5E5E0" stroke-width="1"/>' +
    '<text x="' + H_LEFT + '" y="' + ctaY + '" font-family="' + FF + '" font-weight="700" font-size="22" fill="' + INK + '" letter-spacing="0.04em">' + esc(ctaText) + '</text>' +
  '</svg>';
}

/**
 * Poster variant: GRADIENT — diagonal dark→accent gradient, white sans.
 * App hero / Linear-Vercel aesthetic. Dark top-left, accent bottom-right,
 * big white Inter 900 headline. No bullets; inline CTA at bottom.
 */
function posterCard_gradient(opts) {
  const FF = opts.font_family || 'Inter';
  const eyebrow    = esc(opts.eyebrow     || '');
  const headline   = opts.headline        || '';
  const accentWord = opts.accent_word     || '';
  const sub        = opts.sub             || '';
  const ctaLabel   = esc(opts.cta_label   || '');
  const ctaUrl     = esc(opts.cta_url     || '');

  const DARK   = '#0A0A0A';
  const INK    = '#FFFFFF';
  const SOFT   = '#E5E7EB';                         // near-white
  const ACCENT = opts.brand_accent_hex || '#E11D48';

  // Wrap the headline a little looser than classic so the gradient stays
  // visible in the margins.
  let headlineLines = wrapLines(headline, 20);
  if (headlineLines.length > 3) headlineLines = wrapLines(headline, 26).slice(0, 3);
  const H_SIZE = headlineLines.length <= 2 ? 96 : 80;
  const H_GAP  = Math.round(H_SIZE * 1.08);
  const H_TOP  = 360;

  const accentLC = accentWord.toLowerCase().replace(/[^a-z0-9]/g, '');
  const headlineSvg = headlineLines.map(function (ln, i) {
    const y = H_TOP + i * H_GAP;
    const parts = ln.split(/\s+/).map(function (w) {
      const norm = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      return { w: w, accent: norm === accentLC && !!accentLC };
    });
    const tspans = parts.map(function (p, idx) {
      const prefix = idx === 0 ? '' : ' ';
      // Accent word keeps a subtle brand tint but stays readable on the gradient.
      const fill = p.accent ? '#FFD4DB' : INK;
      return '<tspan fill="' + fill + '">' + esc(prefix + p.w) + '</tspan>';
    }).join('');
    return '<text x="80" y="' + y + '" font-family="' + FF + '" font-weight="900" font-size="' + H_SIZE + '" letter-spacing="-0.04em">' + tspans + '</text>';
  }).join('');

  const subTop   = H_TOP + headlineLines.length * H_GAP + 48;
  // Gradient doesn't render bullets — fold them into the sub so the
  // middle of the canvas doesn't sit empty when rich text was given.
  const richSub  = composeRichSub(sub, opts.bullets, 110);
  const subLines = wrapLines(richSub, 50).slice(0, 2);
  const subSvg = subLines.map(function (ln, i) {
    return '<text x="80" y="' + (subTop + i * 36) + '" font-family="' + FF + '" font-weight="500" font-size="26" fill="' + SOFT + '" opacity="0.9">' + esc(ln) + '</text>';
  }).join('');

  // Inline CTA footer — no colored bar, white text on the already-colored gradient.
  const shownUrl = ctaUrl.length > 44 ? ctaUrl.slice(0, 43) + '…' : ctaUrl;
  const ctaY     = 1140;
  const ctaText  = (ctaLabel ? ctaLabel.toUpperCase() : 'VIEW') + (shownUrl ? '  →  ' + shownUrl : '');

  return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">' +
    '<defs>' +
      '<linearGradient id="poster-slope" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="' + DARK + '"/>' +
        '<stop offset="100%" stop-color="' + ACCENT + '"/>' +
      '</linearGradient>' +
    '</defs>' +
    '<rect width="1200" height="1200" fill="url(#poster-slope)"/>' +
    (eyebrow ? '<text x="80" y="200" font-family="' + FF + '" font-weight="700" font-size="20" letter-spacing="0.3em" fill="' + INK + '" opacity="0.9">' + eyebrow.toUpperCase() + '</text>' : '') +
    headlineSvg +
    subSvg +
    '<text x="80" y="' + ctaY + '" font-family="' + FF + '" font-weight="700" font-size="22" fill="' + INK + '" letter-spacing="0.06em">' + esc(ctaText) + '</text>' +
  '</svg>';
}

/**
 * Poster variant: STUDIO — soft pastel blobs, small accent icon tile,
 * dot-eyebrow, bold black sans headline on near-white. Friendly /
 * shipping-announcement energy. Adapted from the milestone card's
 * aesthetic onto the 1200×1200 poster canvas.
 */
function posterCard_studio(opts) {
  const FF = opts.font_family || 'Inter';
  const eyebrow    = esc(opts.eyebrow     || '');
  const headline   = opts.headline        || '';
  const accentWord = opts.accent_word     || '';
  const sub        = opts.sub             || '';
  const ctaLabel   = esc(opts.cta_label   || '');
  const ctaUrl     = esc(opts.cta_url     || '');
  const iconName   = opts.icon            || 'rocket';

  const BG_FROM = '#FFFFFF';
  const BG_TO   = '#FAF7F0';                         // cream-adjacent warm white
  const INK     = '#1A1A1A';
  const GRAY    = '#57504A';
  const ACCENT  = opts.brand_accent_hex || '#E11D48';

  // Soft blobs — pale pastels that read as background texture, not color.
  const BLOB_PEACH  = '#FFD4B8';
  const BLOB_PINK   = '#FFD4E0';
  const BLOB_LILAC  = '#E0D4FF';

  const accentLC = accentWord.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Headline wrapping — leave generous room on the right for the icon tile
  // when a headline would otherwise collide with it (icon lives at x~960).
  let headlineLines = wrapLines(headline, 18);
  if (headlineLines.length > 4) headlineLines = wrapLines(headline, 24).slice(0, 4);
  const H_SIZE = headlineLines.length <= 3 ? 92 : 76;
  const H_GAP  = Math.round(H_SIZE * 1.08);
  const H_TOP  = 340;

  const headlineSvg = headlineLines.map(function (ln, i) {
    const y = H_TOP + i * H_GAP;
    const parts = ln.split(/\s+/).map(function (w) {
      const norm = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      return { w: w, accent: norm === accentLC && !!accentLC };
    });
    const tspans = parts.map(function (p, idx) {
      const prefix = idx === 0 ? '' : ' ';
      const fill = p.accent ? ACCENT : INK;
      return '<tspan fill="' + fill + '">' + esc(prefix + p.w) + '</tspan>';
    }).join('');
    return '<text x="80" y="' + y + '" font-family="' + FF + '" font-weight="900" font-size="' + H_SIZE + '" letter-spacing="-0.035em">' + tspans + '</text>';
  }).join('');

  const subTop   = H_TOP + headlineLines.length * H_GAP + 48;
  // Studio doesn't render bullets — fold them into the sub.
  const richSub  = composeRichSub(sub, opts.bullets, 110);
  const subLines = wrapLines(richSub, 48).slice(0, 2);
  const subSvg = subLines.map(function (ln, i) {
    return '<text x="80" y="' + (subTop + i * 36) + '" font-family="' + FF + '" font-weight="500" font-size="26" fill="' + GRAY + '">' + esc(ln) + '</text>';
  }).join('');

  // Inline CTA footer + short accent hairline above it.
  const shownUrl = ctaUrl.length > 44 ? ctaUrl.slice(0, 43) + '…' : ctaUrl;
  const ctaY     = 1140;
  const hairY    = ctaY - 48;
  const ctaText  = (ctaLabel ? ctaLabel : 'View') + (shownUrl ? '  →  ' + shownUrl : '');

  return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">' +
    '<defs>' +
      '<linearGradient id="studio-bg" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="' + BG_FROM + '"/>' +
        '<stop offset="100%" stop-color="' + BG_TO + '"/>' +
      '</linearGradient>' +
      '<filter id="studio-blur" x="-50%" y="-50%" width="200%" height="200%">' +
        '<feGaussianBlur stdDeviation="60"/>' +
      '</filter>' +
    '</defs>' +
    '<rect width="1200" height="1200" fill="url(#studio-bg)"/>' +
    // Soft blob cluster — pale pastels, blurred, low opacity so they read as texture.
    '<g filter="url(#studio-blur)">' +
      organicBlob('sb1', 1020, 260, 260, BLOB_PEACH, 0.45, 2) +
      organicBlob('sb2', 180,  900, 300, BLOB_LILAC, 0.40, 5) +
      organicBlob('sb3', 720,  720, 240, BLOB_PINK,  0.35, 8) +
    '</g>' +
    // Icon tile top-right — smaller than the milestone's (120px vs 140)
    // so it doesn't overpower the 1200×1200 canvas.
    '<g transform="translate(980, 100)">' +
      '<rect x="0" y="0" width="140" height="140" rx="30" fill="' + ACCENT + '"/>' +
      '<g transform="translate(20, 20)">' +
        iconPath(iconName, 100, '#FFFFFF', 1.6) +
      '</g>' +
    '</g>' +
    // Dot + UPPERCASE eyebrow in accent color, top-left.
    (eyebrow
      ? '<g transform="translate(80, 200)">' +
          '<circle cx="8" cy="6" r="8" fill="' + ACCENT + '"/>' +
          '<text x="28" y="13" font-family="' + FF + '" font-weight="700" font-size="18" letter-spacing="0.22em" fill="' + ACCENT + '">' + esc(eyebrow.toUpperCase()) + '</text>' +
        '</g>'
      : '') +
    headlineSvg +
    subSvg +
    '<line x1="80" y1="' + hairY + '" x2="200" y2="' + hairY + '" stroke="' + ACCENT + '" stroke-width="2"/>' +
    '<text x="80" y="' + ctaY + '" font-family="' + FF + '" font-weight="700" font-size="22" fill="' + INK + '" letter-spacing="0.04em">' + esc(ctaText) + '</text>' +
  '</svg>';
}

/**
 * Convert SVG → PNG buffer via @resvg/resvg-js.
 * Loaded lazily so only the Publisher pays the cost.
 * @param {string} svg
 * @returns {Promise<Buffer>}
 */
// Available font families. Each maps to a list of TTF filenames in
// lib/pa/fonts/. Static-weight fonts list per-weight files; variable
// fonts list a single file (resvg interpolates the wght axis).
// Add a new entry here + commit the files to offer more.
const FONT_FAMILIES = {
  'Inter': [
    'Inter-Regular.ttf',
    'Inter-Medium.ttf',
    'Inter-SemiBold.ttf',
    'Inter-Bold.ttf',
    'Inter-Black.ttf',
  ],
  'JetBrains Mono': [
    'JetBrainsMono-Regular.ttf',
    'JetBrainsMono-Medium.ttf',
    'JetBrainsMono-Bold.ttf',
    'JetBrainsMono-ExtraBold.ttf',
  ],
  'IBM Plex Sans':  ['IBMPlexSans-Variable.ttf'],
  'Lora':           ['Lora-Variable.ttf'],
  'Space Grotesk':  ['SpaceGrotesk-Variable.ttf'],
  'Noto Sans':      ['NotoSans-Variable.ttf'],
};

function allFontFiles() {
  const path = require('path');
  const fs = require('fs');
  const fontDir = path.join(__dirname, 'fonts');
  const result = [];
  for (const family of Object.keys(FONT_FAMILIES)) {
    for (const file of FONT_FAMILIES[family]) {
      const full = path.join(fontDir, file);
      if (fs.existsSync(full)) result.push(full);
    }
  }
  return result;
}

async function svgToPng(svg, opts) {
  opts = opts || {};
  const { Resvg } = require('@resvg/resvg-js');
  const defaultFamily = FONT_FAMILIES[opts.defaultFamily] ? opts.defaultFamily : 'Inter';
  // Load ALL bundled font files regardless of choice — resvg resolves by
  // font-family name from the SVG, so having them all registered lets the
  // SVG mix families (e.g. body Inter + code JetBrains Mono).
  const fontFiles = allFontFiles();

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      loadSystemFonts: fontFiles.length === 0,
      fontFiles,
      defaultFontFamily: defaultFamily,
    },
  });
  return resvg.render().asPng();
}

module.exports = {
  LUCIDE_ICONS,
  PALETTES,
  POSTER_VARIANTS,
  renderSvg,
  svgToPng,
};
