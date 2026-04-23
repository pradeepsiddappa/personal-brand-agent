// ─────────────────────────────────────────────────────────
// allowlist.js — gate who can sign in
// ─────────────────────────────────────────────────────────

const RAW = process.env.PA_ALLOWED_EMAILS || '';

function isAllowed(email) {
  if (!email) return false;
  if (RAW.trim() === '*') return true;              // open signup
  const list = RAW.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return false;              // misconfigured → deny
  return list.includes(email.trim().toLowerCase());
}

module.exports = { isAllowed };
