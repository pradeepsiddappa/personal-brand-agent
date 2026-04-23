// POST /api/pa/image/generate   body: { kind, ...spec }
//
// Returns the card as a PNG (Buffer, Content-Type image/png).
// Used by the Publisher right before Twitter media upload,
// and by the dashboard when the user wants to download the final PNG.

const { renderSvg, svgToPng } = require('../../../lib/pa/image');
const { handler, bad } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  const spec = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  if (!spec || Object.keys(spec).length === 0) return bad(res, 'spec required');

  const svg = renderSvg(spec);
  const png = await svgToPng(svg);

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', String(png.length));
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).send(png);
});
