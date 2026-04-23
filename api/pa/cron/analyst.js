// Cron: Sunday 20:00 IST — Analyst weekly report.

const { admin } = require('../../../lib/pa/supabase');
const { runAgent } = require('../../../lib/pa/agent-runner');
const { handler, ok } = require('../../../lib/pa/http');

module.exports = handler(async (req, res) => {
  const sb = admin();
  const { data: agents } = await sb
    .from('agents_config')
    .select('user_id')
    .eq('id', 'analyst')
    .eq('enabled', true);

  const results = [];
  for (const a of (agents || [])) {
    try { results.push({ user: a.user_id, ok: true, r: await runAgent(a.user_id, 'analyst') }); }
    catch (e) { results.push({ user: a.user_id, ok: false, error: e.message }); }
  }
  ok(res, { ran: results.length, results });
});
