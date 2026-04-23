// GET  /api/pa/image/preview?kind=stat&number=15%2B&label=Years&icon=rocket
// POST /api/pa/image/preview   body: { kind, ...spec }
//
// Returns the card as SVG (fast, no PNG conversion).
// Used by the dashboard to preview a generated card before it's sent.

const { renderSvg } = require('../../../lib/pa/image');
const { handler } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  const spec = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const svg = renderSvg(spec);
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).send(svg);
});
