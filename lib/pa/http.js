// ─────────────────────────────────────────────────────────
// http.js — tiny helpers for Vercel Function responses
// ─────────────────────────────────────────────────────────

function ok(res, data) {
  res.status(200).setHeader('Content-Type', 'application/json').send(JSON.stringify(data ?? { ok: true }));
}

function bad(res, message, status = 400) {
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify({ error: message }));
}

/** Wrap an async handler so thrown errors become JSON responses. */
function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      console.error('[pa] handler error:', e);
      bad(res, e.message || 'Server error', status);
    }
  };
}

function allow(method, req) {
  if (req.method !== method) {
    const err = new Error(`Method ${req.method} not allowed`);
    err.status = 405;
    throw err;
  }
}

module.exports = { ok, bad, handler, allow };
