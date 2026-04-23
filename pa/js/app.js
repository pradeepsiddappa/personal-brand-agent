// ─────────────────────────────────────────────────────────
// app.js — dashboard shell (Alpine.js data component)
// Loaded as regular <script> BEFORE Alpine CDN.
// Exposes window.appShell for x-data="appShell()".
// ─────────────────────────────────────────────────────────

// Gate: if no session, bounce to /pa/auth.
// If we DO have a refresh_token but the access_token is expired, let the
// api.js layer auto-refresh on the first request — don't bounce.
// Only redirect when there's literally nothing we can recover from.
(function () {
  var s = paSession.get();
  var noSession      = !s || !s.access_token;
  var noRefreshToken = !s || !s.refresh_token;
  var expired        = s && s.expires_at && s.expires_at < Date.now();
  if (noSession || (expired && noRefreshToken)) {
    window.location.replace('/pa/auth');
  }
})();

var TABS = [
  { id: 'flow',       label: 'Flow' },
  { id: 'timeline',   label: 'Timeline' },
  { id: 'approval',   label: 'Approval' },
  { id: 'analytics',  label: 'Analytics' },
  { id: 'agents',     label: 'Agents' },
  { id: 'settings',   label: 'Settings' },
];

function agentStub(id, name) {
  return { agent: id, name: name, status: 'idle', statusClass: 'idle', payload: '—' };
}

// Agent identity + role labels used in the Flow hero.
var AGENT_DEFS = [
  { id: 'scout',     name: 'Scout',     role: 'SIGNAL HUNTER', icon: 'target',  tone: 'sky'     },
  { id: 'writer',    name: 'Writer',    role: 'VOICE DOUBLE',  icon: 'pen',     tone: 'orange'  },
  { id: 'editor',    name: 'Editor',    role: 'QUALITY GATE',  icon: 'check',   tone: 'violet'  },
  { id: 'messenger', name: 'Messenger', role: 'COURIER',       icon: 'send',    tone: 'sage'    },
  { id: 'publisher', name: 'Publisher', role: 'SHIPPER',       icon: 'upright', tone: 'terra'   },
  { id: 'analyst',   name: 'Analyst',   role: 'HISTORIAN',     icon: 'wave',    tone: 'navy'    },
  { id: 'seo',       name: 'SEO',       role: 'SITE AUDITOR',  icon: 'target',  tone: 'sky'     },
];

window.appShell = function () {
  return {
    user: null,
    view: localStorage.getItem('pa.view') || 'flow',
    tabs: TABS,
    clock: '',
    uberGoal: '',
    editingGoal: false,
    goalDraft: '',
    brandForm: { brand_voice: '', website_url: '', promotions: '', brand_accent_hex: '', design_language: '', reference_links: '', tweet_templates: '', image_font: 'Inter' },
    // Accordion state for the Settings tab — which groups are expanded.
    // Restored from localStorage so the user's preference sticks.
    settingsOpen: (function () {
      try {
        var s = JSON.parse(localStorage.getItem('pa.settingsOpen') || '{}');
        return { brand: s.brand !== false, content: !!s.content, connections: !!s.connections };
      } catch (e) { return { brand: true, content: false, connections: false }; }
    })(),
    bulkVoiceText: '',
    bulkVoiceSaving: false,
    brandSaving: false,
    githubForm: { github_repo: '', github_branch: 'main', github_token: '', github_token_set: false },
    githubSaving: false,
    toast: null,
    agents: [],
    drafts: [],
    events: [],
    settingsItems: [
      { key: 'claude',   label: 'Claude / Anthropic', connected: false, value: '' },
      { key: 'twitter',  label: 'Twitter / X',        connected: false, value: '' },
      { key: 'telegram', label: 'Telegram',           connected: false, value: '' },
      { key: 'linkedin', label: 'LinkedIn',            connected: false, value: '' },
    ],
    drawer: { open: false, agent: {} },
    connectForms: {},                    // { claude: {...}, twitter: {...} }  — per-service form state
    settingsHelp: {
      claude: 'Powers the Writer, Editor, and Analyst agents. Get your key from console.anthropic.com. Costs ~$3-5/month at this usage.',
      twitter: 'OAuth connection to your X account. The Publisher agent posts approved drafts here. Requires a developer app at developer.x.com.',
      telegram: 'Your approval channel. The Messenger agent sends draft cards here with approve/reject buttons. Create a bot via @BotFather.',
      linkedin: 'Cross-post to LinkedIn with the same branded image. Needs a LinkedIn Developer app (see the setup guide below). Connect authorises posting and fetches your member URN.',
    },
    pipelineNodes: [
      agentStub('scout',     'Scout'),
      agentStub('writer',    'Writer'),
      agentStub('editor',    'Editor'),
      agentStub('messenger', 'Messenger'),
      agentStub('publisher', 'Publisher'),
    ],
    analystSummary: 'No report yet. First run: Sunday 20:00 IST.',
    timelineGroups: [],
    rawEvents: [],
    agentDefs: AGENT_DEFS,

    init: function () {
      var self = this;
      this.startClock();
      this.$watch('view', function (v) { localStorage.setItem('pa.view', v); });

      this.loadUser();
      Promise.all([
        this.loadAgents(),
        this.loadSettings(),
        this.refreshPipeline(),
        this.loadEvents(),
      ]).catch(function (e) { console.warn('init:', e); });
    },

    startClock: function () {
      var self = this;
      function tick() {
        var now = new Date();
        self.clock = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST';
      }
      tick();
      setInterval(tick, 30000);
    },

    loadUser: function () {
      var s = paSession.get();
      if (!s || !s.access_token) return;
      try {
        var payload = JSON.parse(atob(s.access_token.split('.')[1]));
        this.user = { email: payload.email, id: payload.sub };
      } catch (e) { this.user = null; }
    },

    loadAgents: function () {
      var self = this;
      return paApi.listAgents().then(function (data) {
        self.agents = (data.agents || []).map(function (a) {
          a._running = false;
          return a;
        });
        self.uberGoal = data.uber_goal || '';
      }).catch(function (e) { console.warn('listAgents:', e.message); });
    },

    loadSettings: function () {
      var self = this;
      return paApi.getSettings().then(function (data) {
        if (!data) return;
        self.settingsItems.forEach(function (s) {
          var v = data[s.key];
          if (v) {
            s.connected = !!v.connected;
            s.value = v.masked || '';
          }
        });
        self.brandForm.brand_voice = data.brand_voice || '';
        self.brandForm.website_url = data.website_url || '';
        self.brandForm.promotions  = data.promotions  || '';
        self.brandForm.brand_accent_hex = data.brand_accent_hex || '';
        self.brandForm.design_language  = data.design_language  || '';
        self.brandForm.reference_links  = data.reference_links  || '';
        self.brandForm.tweet_templates  = data.tweet_templates  || '';
        self.brandForm.image_font       = data.image_font       || 'Inter';
        self.githubForm.github_repo = data.github_repo || '';
        self.githubForm.github_branch = data.github_branch || 'main';
        self.githubForm.github_token_set = !!data.github_token_set;
        self.githubForm.github_token = '';
      }).catch(function (e) { console.warn('getSettings:', e.message); });
    },

    saveGithub: function () {
      if (this.githubSaving) return;
      var self = this;
      this.githubSaving = true;
      var payload = {
        github_repo: this.githubForm.github_repo,
        github_branch: this.githubForm.github_branch || 'main',
      };
      if (this.githubForm.github_token) payload.github_token = this.githubForm.github_token;
      paApi.saveSettings(payload).then(function () {
        self.githubSaving = false;
        self.githubForm.github_token = '';
        self.githubForm.github_token_set = true;
        self.showToast('GitHub saved — SEO auto-commit ready', 'ok');
      }).catch(function (e) {
        self.githubSaving = false;
        self.showToast('Save failed: ' + e.message, 'err');
      });
    },

    saveBrand: function () {
      if (this.brandSaving) return;
      var self = this;
      this.brandSaving = true;
      paApi.saveSettings({
        brand_voice: this.brandForm.brand_voice,
        website_url: this.brandForm.website_url,
        promotions:  this.brandForm.promotions,
        brand_accent_hex: this.brandForm.brand_accent_hex,
        design_language:  this.brandForm.design_language,
        reference_links:  this.brandForm.reference_links,
        tweet_templates:  this.brandForm.tweet_templates,
        image_font:       this.brandForm.image_font,
      }).then(function () {
        self.brandSaving = false;
        self.showToast('Brand context saved — Writer + SEO will use it on the next run', 'ok');
      }).catch(function (e) {
        self.brandSaving = false;
        self.showToast('Save failed: ' + e.message, 'err');
      });
    },

    toggleSettings: function (key) {
      this.settingsOpen[key] = !this.settingsOpen[key];
      try { localStorage.setItem('pa.settingsOpen', JSON.stringify(this.settingsOpen)); } catch (e) {}
    },

    // ── Persona picker ──────────────────────────────────
    personaList: [],
    personaPickerOpen: false,
    personaApplying: false,
    openPersonaPicker: function () {
      var self = this;
      this.personaPickerOpen = true;
      if (this.personaList.length === 0) {
        paApi.listPersonas().then(function (res) { self.personaList = res.personas || []; })
          .catch(function (e) { self.showToast('Load personas failed: ' + e.message, 'err'); });
      }
    },
    closePersonaPicker: function () { this.personaPickerOpen = false; },
    applyPersona: function (key) {
      if (this.personaApplying) return;
      var hasContent = (this.brandForm.brand_voice || '').trim() || (this.uberGoal || '').trim();
      if (hasContent && !confirm('This will overwrite your current brand voice / uber goal / reference links with the persona\'s starter content. Continue?')) return;
      var self = this;
      this.personaApplying = true;
      paApi.applyPersona(key, true).then(function (res) {
        self.personaApplying = false;
        self.personaPickerOpen = false;
        self.showToast('Applied "' + res.name + '" — reloading your settings…', 'ok');
        return Promise.all([self.loadSettings(), self.loadAgents()]);
      }).catch(function (e) {
        self.personaApplying = false;
        self.showToast('Apply failed: ' + e.message, 'err');
      });
    },

    saveBulkVoice: function () {
      if (this.bulkVoiceSaving) return;
      var text = (this.bulkVoiceText || '').trim();
      if (!text) { this.showToast('Paste some tweets first', 'err'); return; }
      var self = this;
      this.bulkVoiceSaving = true;
      paApi.bulkVoice(text).then(function (res) {
        self.bulkVoiceSaving = false;
        self.bulkVoiceText = '';
        self.showToast('Added ' + (res && res.added) + ' to voice library', 'ok');
      }).catch(function (e) {
        self.bulkVoiceSaving = false;
        self.showToast('Save failed: ' + e.message, 'err');
      });
    },

    resetAgentPrompt: function (agent) {
      if (!confirm('Reset ' + agent.name + '\'s prompt template to the latest default? Any custom edits will be lost.')) return;
      var self = this;
      paApi.resetAgent(agent.id).then(function () {
        self.loadAgents();
        self.showToast(agent.name + ' reset to default', 'ok');
      }).catch(function (e) { self.showToast('Reset failed: ' + e.message, 'err'); });
    },

    refreshPipeline: function () {
      var self = this;
      return paApi.getDrafts().then(function (data) {
        self.drafts = (data.drafts || []).map(function (d) {
          d._deciding = false;
          d._editing = false;
          d._tweaking = false;
          d._tweakInstruction = '';
          d._editText = '';
          d._editTextLinkedin = '';
          return d;
        });
        self.pipelineNodes.forEach(function (n) {
          var d = self.drafts.find(function (x) { return x.stage === n.agent; });
          if (d) {
            n.payload = d.id + ': "' + (d.text || '').slice(0, 42) + '…"';
            n.status = 'working';
            n.statusClass = 'live';
          } else {
            n.payload = '—';
            n.status = 'idle';
            n.statusClass = 'idle';
          }
        });
      }).catch(function (e) { console.warn('getDrafts:', e.message); });
    },

    loadEvents: function () {
      var self = this;
      return paApi.getEvents().then(function (data) {
        var events = data.events || [];
        self.rawEvents = events;
        var groups = {};
        events.forEach(function (e) {
          var d = new Date(e.created_at);
          var key = d.toDateString();
          if (!groups[key]) groups[key] = [];
          groups[key].push({
            id: e.id,
            time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
            agent: e.agent,
            title: e.title,
            detail: e.detail || '',
            tag: e.tag || '',
          });
        });
        self.timelineGroups = Object.keys(groups).map(function (date) {
          return { date: date, items: groups[date] };
        });
      }).catch(function (e) { console.warn('getEvents:', e.message); });
    },

    // Last run event ('started' | 'ok' | 'error') for a given agent id, or null.
    lastRunEventOf: function (agentId) {
      for (var i = 0; i < this.rawEvents.length; i++) {
        var e = this.rawEvents[i];
        if (e.agent === agentId && e.kind === 'run') return e;
      }
      return null;
    },

    // True if the most recent run event is 'started' without a matching finish.
    // Stale-run guard: if the 'started' event is older than 3 minutes we
    // treat it as crashed (Vercel's max function budget is 300s; anything
    // past 3 min means the process died without logging 'done' or 'error').
    isRunningOf: function (agentId) {
      var e = this.lastRunEventOf(agentId);
      if (!e || e.tag !== 'started') return false;
      var ageMs = Date.now() - new Date(e.created_at).getTime();
      return ageMs < 3 * 60 * 1000;
    },

    // Last completed run timestamp ('ok' or 'error'), or null.
    lastCompletedRunOf: function (agentId) {
      for (var i = 0; i < this.rawEvents.length; i++) {
        var e = this.rawEvents[i];
        if (e.agent === agentId && e.kind === 'run' && (e.tag === 'ok' || e.tag === 'error')) {
          return e.created_at;
        }
      }
      return null;
    },

    // "3m ago" / "2h ago" / "Apr 18"
    timeAgo: function (iso) {
      if (!iso) return '';
      var diff = Date.now() - new Date(iso).getTime();
      var s = Math.floor(diff / 1000);
      if (s < 10) return 'just now';
      if (s < 60) return s + 's ago';
      var m = Math.floor(s / 60);
      if (m < 60) return m + 'm ago';
      var h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      var d = Math.floor(h / 24);
      if (d < 7) return d + 'd ago';
      return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    },

    // "2h 14m" style countdown to next scheduled run.
    timeUntil: function (iso) {
      if (!iso) return '';
      var diff = new Date(iso).getTime() - Date.now();
      if (diff <= 0) return 'any moment';
      var m = Math.floor(diff / 60000);
      var h = Math.floor(m / 60);
      var d = Math.floor(h / 24);
      if (d > 0) return d + 'd ' + String(h % 24).padStart(2, '0') + 'h';
      if (h > 0) return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
      return m + 'm';
    },

    // Compute next-run ISO for a schedule string. Rough heuristics for common formats.
    nextRunOf: function (agentId) {
      var agent = this.agents.find(function (a) { return a.id === agentId; });
      if (!agent || agent.schedule === 'manual' || !agent.schedule) return null;
      var now = new Date();
      var sch = String(agent.schedule).toLowerCase();
      // every_6h → next 6h boundary from midnight
      if (/every.?6h/.test(sch)) {
        var next = new Date(now);
        next.setMinutes(0, 0, 0);
        var hr = next.getHours();
        next.setHours(hr + (6 - (hr % 6)));
        return next.toISOString();
      }
      // daily_HH:MM
      var dm = sch.match(/daily.*?(\d{1,2}):(\d{2})/);
      if (dm) {
        var h = parseInt(dm[1], 10), mi = parseInt(dm[2], 10);
        var d = new Date(now); d.setHours(h, mi, 0, 0);
        if (d <= now) d.setDate(d.getDate() + 1);
        return d.toISOString();
      }
      // weekly_sunday_HH:MM (0=Sun)
      var wm = sch.match(/sunday.*?(\d{1,2}):(\d{2})/);
      if (wm) {
        var hh = parseInt(wm[1], 10), mm = parseInt(wm[2], 10);
        var w = new Date(now); w.setHours(hh, mm, 0, 0);
        var delta = (7 - w.getDay()) % 7;
        if (delta === 0 && w <= now) delta = 7;
        w.setDate(w.getDate() + delta);
        return w.toISOString();
      }
      return null;
    },

    // Computed flow nodes for the hero visualization.
    buildFlowNodes: function () {
      var self = this;
      return self.agentDefs.map(function (def) {
        var draft = self.drafts.find(function (x) { return x.stage === def.id; });
        var running = self.isRunningOf(def.id);
        var state = running ? 'running' : (draft ? 'live' : 'idle');
        var lastRun = self.lastCompletedRunOf(def.id);
        var nextIso = self.nextRunOf(def.id);
        return {
          id: def.id,
          name: def.name,
          role: def.role,
          icon: def.icon,
          tone: def.tone,
          state: state,
          running: running,
          draftId: draft ? draft.id : '',
          draftText: draft ? ((draft.text || '').slice(0, 80) + (draft.text && draft.text.length > 80 ? '…' : '')) : '',
          draftFullText: draft ? (draft.text || '') : '',
          lastRunAgo: lastRun ? self.timeAgo(lastRun) : '',
          nextRun: nextIso ? self.timeUntil(nextIso) : '',
        };
      });
    },

    get flowNodes() { return this.buildFlowNodes(); },

    get inFlightCount() {
      return this.buildFlowNodes().filter(function (n) { return n.state !== 'idle'; }).length;
    },

    get lastTickLabel() {
      if (!this.rawEvents.length) return '';
      var d = new Date(this.rawEvents[0].created_at);
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    },

    // Pluralize "N agents" with a word for small counts so the headline reads naturally
    // ("Seven agents, one desk." vs "7 agents, one desk.").
    get agentCountLabel() {
      var n = (this.agents || []).length || 6;
      var words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
      var label = n < words.length ? words[n] : String(n);
      return label + ' ' + (n === 1 ? 'agent' : 'agents');
    },

    editAgent: function (agent) {
      this.drawer = { open: true, agent: JSON.parse(JSON.stringify(agent)) };
    },

    // ── Approval tab helpers ───────────────────────────
    get pendingDrafts() {
      return this.drafts.filter(function (d) { return d.stage === 'messenger'; });
    },
    get recentDecisions() {
      return this.drafts.filter(function (d) { return d.stage === 'rejected' || d.stage === 'done'; }).slice(0, 10);
    },
    // ── Inline edit ──────────────────────────────────────
    startEditDraft: function (draft) {
      draft._editing = true;
      draft._editText = draft.text || '';
      draft._editTextLinkedin = draft.text_linkedin || '';
    },
    cancelEditDraft: function (draft) {
      draft._editing = false;
      draft._editText = '';
      draft._editTextLinkedin = '';
    },
    saveEditDraft: function (draft) {
      if (draft._saving) return;
      draft._saving = true;
      var self = this;
      paApi.editDraft(draft.id, {
        text: draft._editText,
        text_linkedin: draft._editTextLinkedin,
      }).then(function () {
        draft.text = draft._editText;
        draft.text_linkedin = draft._editTextLinkedin;
        draft._editing = false;
        draft._saving = false;
        self.showToast('Saved ' + draft.id, 'ok');
      }).catch(function (e) {
        draft._saving = false;
        self.showToast('Edit failed: ' + e.message, 'err');
      });
    },

    // ── AI tweak ─────────────────────────────────────────
    startTweakDraft: function (draft) {
      draft._tweaking = true;
      draft._tweakInstruction = '';
    },
    cancelTweakDraft: function (draft) {
      draft._tweaking = false;
      draft._tweakInstruction = '';
    },
    submitTweakDraft: function (draft) {
      var instruction = (draft._tweakInstruction || '').trim();
      if (!instruction) { this.showToast('Type what to change', 'err'); return; }
      if (draft._tweaking_busy) return;
      draft._tweaking_busy = true;
      var self = this;
      this.showToast('Rewriting ' + draft.id + '…');
      paApi.tweakDraft(draft.id, instruction).then(function (res) {
        if (res && res.text)          draft.text = res.text;
        if (res && res.text_linkedin) draft.text_linkedin = res.text_linkedin;
        if (res && res.thread_parts)  draft.thread_parts = res.thread_parts;
        draft._tweaking = false;
        draft._tweakInstruction = '';
        draft._tweaking_busy = false;
        self.showToast('Tweaked ' + draft.id, 'ok');
      }).catch(function (e) {
        draft._tweaking_busy = false;
        self.showToast('Tweak failed: ' + e.message, 'err');
      });
    },

    regenerateImage: function (draft) {
      var self = this;
      paApi.regenerateImage(draft.id).then(function (res) {
        self.refreshPipeline();
        self.showToast('Regenerated image for ' + draft.id + ' (' + (res && res.spec_kind) + ')', 'ok');
      }).catch(function (e) { self.showToast('Regenerate failed: ' + e.message, 'err'); });
    },

    deleteDraftHard: function (draft) {
      if (!confirm('Delete ' + draft.id + ' permanently? (Use for hallucinated drafts.)')) return;
      var self = this;
      paApi.deleteDraft(draft.id).then(function () {
        self.refreshPipeline();
        self.loadEvents();
        self.showToast('Deleted ' + draft.id, 'ok');
      }).catch(function (e) { self.showToast('Delete failed: ' + e.message, 'err'); });
    },

    decideDraft: function (draft, action, platforms) {
      if (draft._deciding) return;
      draft._deciding = true;
      var self = this;
      paApi.decideDraft(draft.id, action, platforms).then(function () {
        var msg = action === 'approve'
          ? 'Draft ' + draft.id + ' approved' + (platforms && platforms.length ? ' → ' + platforms.join(' + ') : '') + ' — Publisher will pick it up'
          : 'Draft ' + draft.id + ' rejected';
        self.showToast(msg, 'ok');
        self.refreshPipeline();
        self.loadEvents();
      }).catch(function (e) {
        draft._deciding = false;
        self.showToast('Decision failed: ' + e.message, 'err');
      });
    },

    // ── Run whole pipeline ─────────────────────────────
    // Chains Scout → Writer → Editor → Messenger from the browser so each
    // server call has its own 10s timeout budget (avoids Vercel 504s that
    // hit any user on the Hobby plan when the server tried to chain it).
    runningPipeline: false,
    pipelineStage: '',
    runPipeline: function () {
      if (this.runningPipeline) return;
      var self = this;
      var chain = ['scout', 'writer', 'editor', 'messenger'];
      self.runningPipeline = true;

      function step(i) {
        if (i >= chain.length) {
          self.runningPipeline = false;
          self.pipelineStage = '';
          self.showToast('Pipeline finished — check the Approval tab', 'ok');
          self.refreshPipeline();
          self.loadEvents();
          return;
        }
        var id = chain[i];
        self.pipelineStage = id;
        self.showToast('Pipeline · ' + id + '…');
        // Keep the UI live — the 'started' event shows up within ~500ms.
        setTimeout(function () { self.loadEvents(); }, 500);
        paApi.runAgent(id).then(function (res) {
          var r = res && res.result;
          if (r && r.skipped && r.reason !== 'disabled') {
            // Paused — treat as a soft stop, don't chain further.
            self.runningPipeline = false;
            self.pipelineStage = '';
            self.showToast(id + ' is ' + r.reason + ' — pipeline stopped', 'err');
            self.loadEvents();
            return;
          }
          self.loadEvents();
          self.refreshPipeline();
          step(i + 1);
        }).catch(function (e) {
          self.runningPipeline = false;
          self.pipelineStage = '';
          self.showToast('Pipeline failed at ' + id + ': ' + e.message, 'err');
          self.loadEvents();
        });
      }
      step(0);
    },

    clearStuck: function (agent) {
      var self = this;
      paApi.clearStuckAgent(agent.id).then(function () {
        agent._running = false;
        self.loadEvents();
        self.showToast(agent.name + ' state cleared', 'ok');
      }).catch(function (e) { self.showToast('Clear failed: ' + e.message, 'err'); });
    },

    // ── Pause / resume agent ───────────────────────────
    pauseAgent: function (agent, hours) {
      var self = this;
      paApi.pauseAgent(agent.id, hours).then(function () {
        self.loadAgents();
        self.showToast(
          hours > 0 ? agent.name + ' paused for ' + hours + 'h' : agent.name + ' resumed',
          'ok'
        );
      }).catch(function (e) { self.showToast('Pause failed: ' + e.message, 'err'); });
    },
    isPausedNow: function (agent) {
      return !!(agent && agent.paused_until && new Date(agent.paused_until) > new Date());
    },
    pausedUntilLabel: function (agent) {
      if (!this.isPausedNow(agent)) return '';
      return 'paused · resumes ' + this.timeUntil(agent.paused_until) + ' from now';
    },

    saveAgent: function () {
      var self = this;
      paApi.saveAgent(this.drawer.agent).then(function () {
        self.loadAgents();
        self.drawer.open = false;
      }).catch(function (e) { alert('Save failed: ' + e.message); });
    },

    runAgent: function (agent) {
      if (agent._running || this.isRunningOf(agent.id)) return;
      var self = this;
      agent._running = true;
      this.showToast(agent.name + ' is running…');
      // Pull the 'started' event into the UI immediately so Flow shows it live.
      setTimeout(function () { self.loadEvents(); }, 500);
      paApi.runAgent(agent.id).then(function (res) {
        agent._running = false;
        var detail = self.summarizeRun(res && res.result);
        self.showToast(agent.name + ' finished' + (detail ? ' — ' + detail : ''), 'ok');
        self.refreshPipeline();
        self.loadEvents();
      }).catch(function (e) {
        agent._running = false;
        self.showToast(agent.name + ' failed: ' + e.message, 'err');
        self.loadEvents();
      });
    },

    summarizeRun: function (r) {
      if (!r) return '';
      if (r.skipped) return 'skipped (disabled)';
      if (r.draftsCreated != null) return r.draftsCreated + ' drafts created';
      if (r.posted != null) return 'posted ' + r.posted;
      if (r.sent != null) return 'sent ' + r.sent + ' to Telegram';
      if (r.draftId && r.stage) return 'draft ' + r.draftId + ' → ' + r.stage;
      if (r.message) return r.message;
      return 'done';
    },

    showToast: function (msg, kind) {
      var self = this;
      this.toast = { msg: msg, kind: kind || 'info' };
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(function () { self.toast = null; }, 5000);
    },

    toggleAgent: function (agent) {
      agent.enabled = !agent.enabled;
      paApi.saveAgent(agent).catch(function (e) {
        agent.enabled = !agent.enabled;
        alert(e.message);
      });
    },

    startEditGoal: function () {
      this.goalDraft = this.uberGoal || '';
      this.editingGoal = true;
    },

    cancelEditGoal: function () {
      this.editingGoal = false;
      this.goalDraft = '';
    },

    saveUberGoal: function () {
      var next = (this.goalDraft || '').trim();
      if (!next) { this.showToast('Goal can’t be empty', 'err'); return; }
      var self = this;
      paApi.saveSettings({ uber_goal: next }).then(function () {
        self.uberGoal = next;
        self.editingGoal = false;
        self.goalDraft = '';
        self.showToast('Uber goal saved', 'ok');
      }).catch(function (e) { self.showToast(e.message, 'err'); });
    },

    addAgent: function () {
      var id = 'custom_' + Math.random().toString(36).slice(2, 7);
      this.editAgent({
        id: id,
        name: 'New agent',
        role: '',
        goal: '',
        prompt_template: '',
        schedule: 'manual',
        depends_on: [],
        enabled: true,
        order_index: this.agents.length + 1,
      });
    },

    // ── Inline connect-form flow ────────────────────────
    // Each service gets a schema of fields; `openConnectForm` seeds an
    // empty object in `connectForms[key]` which the Alpine template uses
    // to render inputs. Secret fields use type="password" with a show toggle.

    connectFields: function (key) {
      if (key === 'claude') {
        return [{
          name: 'claude', label: 'API Key', type: 'password',
          placeholder: 'sk-ant-api03-...',
          help: 'From console.anthropic.com → API Keys',
          shown: false,
        }];
      }
      if (key === 'telegram') {
        return [
          { name: 'telegram', label: 'Bot Token', type: 'password',
            placeholder: '1234567890:ABCDEF...',
            help: 'From @BotFather — create a bot with /newbot',
            shown: false },
          { name: 'telegram_chat_id', label: 'Chat ID', type: 'text',
            placeholder: '123456789',
            help: 'Send /start to your bot, then visit https://api.telegram.org/bot<TOKEN>/getUpdates and copy chat.id',
            shown: true },
        ];
      }
      if (key === 'twitter') {
        return [
          { name: 'twitter_client_id', label: 'Client ID', type: 'text',
            placeholder: 'abc123...',
            help: 'From developer.x.com → your app → Keys & Tokens',
            shown: true },
          { name: 'twitter_client_secret', label: 'Client Secret', type: 'password',
            placeholder: '••••••',
            help: 'Same page as Client ID. Will encrypt before storing.',
            shown: false },
        ];
      }
      if (key === 'linkedin') {
        return [
          { name: 'linkedin_client_id', label: 'Client ID', type: 'text',
            placeholder: '78xxxxxxxx',
            help: 'From developer.linkedin.com → your app → Auth tab',
            shown: true },
          { name: 'linkedin_client_secret', label: 'Client Secret', type: 'password',
            placeholder: '••••••',
            help: 'Same Auth tab. Will encrypt before storing.',
            shown: false },
        ];
      }
      return [];
    },

    requiresOAuth: function (key) {
      return key === 'twitter' || key === 'linkedin';
    },

    openConnectForm: function (s) {
      // Seed an empty object so Alpine reactivity sees the keys
      var form = { _saving: false };
      this.connectFields(s.key).forEach(function (f) { form[f.name] = ''; });
      this.connectForms[s.key] = form;
    },

    closeConnectForm: function (key) {
      this.connectForms[key] = null;
    },

    submitConnectForm: function (s) {
      var self = this;
      var form = this.connectForms[s.key];
      if (!form) return;

      // Copy the fields into the payload (drop the _saving flag)
      var payload = {};
      this.connectFields(s.key).forEach(function (f) {
        if (form[f.name]) payload[f.name] = String(form[f.name]).trim();
      });

      // Validate: all fields required
      var missing = this.connectFields(s.key).filter(function (f) { return !payload[f.name]; });
      if (missing.length) {
        alert('Please fill in: ' + missing.map(function (f) { return f.label; }).join(', '));
        return;
      }

      form._saving = true;
      paApi.saveSettings(payload).then(function () {
        if (self.requiresOAuth(s.key)) {
          // Start OAuth: call the -start endpoint as an authenticated POST
          // (browser redirects can't carry auth headers, so we fetch the
          // authorize URL ourselves, then navigate).
          return paApi.startOAuth(s.key).then(function (r) {
            if (!r || !r.url) throw new Error('OAuth start: no url returned');
            window.location.href = r.url;
          });
        }
        self.connectForms[s.key] = null;
        self.loadSettings();
      }).catch(function (e) {
        form._saving = false;
        alert('Save failed: ' + e.message);
      });
    },

    testSetting: function (s) {
      paApi.testSetting(s.key).then(function (r) {
        alert(r.ok ? s.label + ' ✓ connected' : s.label + ' ✗ ' + r.error);
      }).catch(function (e) { alert(e.message); });
    },

    signOut: function () {
      paSession.set(null);
      window.location.replace('/pa/auth');
    },
  };
};
