// ─────────────────────────────────────────────────────────
// api.js — client wrapper for /api/pa/* endpoints
// Loaded as a regular <script>, exposes window.paApi + window.paSession
// ─────────────────────────────────────────────────────────

(function () {
  var BASE = '/api/pa';

  function getSession() {
    try {
      var raw = localStorage.getItem('pa.session');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setSession(session) {
    if (session) localStorage.setItem('pa.session', JSON.stringify(session));
    else localStorage.removeItem('pa.session');
  }

  var _refreshing = null;

  function doFetch(path, opts, token) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  }

  // Swap the expired access_token for a fresh one using the refresh_token.
  // Concurrent callers share a single in-flight refresh.
  function doRefresh() {
    if (_refreshing) return _refreshing;
    var session = getSession();
    if (!session || !session.refresh_token) return Promise.reject(new Error('no refresh token'));
    _refreshing = fetch(BASE + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    }).then(function (r) {
      if (!r.ok) throw new Error('refresh ' + r.status);
      return r.json();
    }).then(function (tok) {
      setSession({
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
      });
      _refreshing = null;
      return tok.access_token;
    }).catch(function (e) {
      _refreshing = null;
      throw e;
    });
    return _refreshing;
  }

  function parseResponse(res) {
    if (!res.ok) {
      return res.json().catch(function () { return { error: res.statusText }; }).then(function (err) {
        throw new Error(err.error || 'HTTP ' + res.status);
      });
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // Refresh proactively if we're within 5 minutes of expiry — avoids the
  // race where parallel requests both send the now-stale access token,
  // one refreshes, the other sees 401, Supabase's reuse detection kills
  // the whole session, and the user gets bounced to /pa/auth.
  function needsProactiveRefresh(session) {
    if (!session || !session.refresh_token || !session.expires_at) return false;
    return (session.expires_at - Date.now()) < 5 * 60 * 1000;
  }

  function request(path, opts) {
    opts = opts || {};
    var auth = opts.auth !== false;
    var session = getSession();

    // Proactive: if expiring soon, refresh before sending the real request.
    // Skips for the refresh call itself and for unauthenticated paths.
    if (auth && session && needsProactiveRefresh(session) && path !== '/auth/refresh') {
      return doRefresh().then(function () {
        return request(path, opts);
      }).catch(function () {
        // Fall through — let the request hit 401 and use the reactive path.
        return _doRequest(path, opts);
      });
    }
    return _doRequest(path, opts);
  }

  function _doRequest(path, opts) {
    var auth = opts.auth !== false;
    var session = getSession();
    var token = auth && session ? session.access_token : null;

    return doFetch(path, opts, token).then(function (res) {
      if (res.status === 401 && auth && session && session.refresh_token && !opts._retried) {
        return doRefresh().then(function (fresh) {
          opts._retried = true;
          return doFetch(path, opts, fresh).then(parseResponse);
        }).catch(function (e) {
          // Refresh itself failed — session is truly dead, bounce to login.
          setSession(null);
          if (window.location.pathname !== '/pa/auth') window.location.replace('/pa/auth');
          throw new Error('Session expired — please sign in again');
        });
      }
      return parseResponse(res);
    });
  }

  window.paApi = {
    requestMagicLink: function (email) {
      return request('/auth/login', { method: 'POST', body: { email: email }, auth: false });
    },
    getSettings: function () { return request('/settings/get'); },
    saveSettings: function (payload) { return request('/settings/save', { method: 'POST', body: payload }); },
    bulkVoice: function (text) { return request('/settings/bulk-voice', { method: 'POST', body: { text: text } }); },
    listPersonas: function () { return request('/settings/apply-persona', { method: 'GET' }); },
    applyPersona: function (key, overwrite) { return request('/settings/apply-persona', { method: 'POST', body: { persona_key: key, overwrite: overwrite } }); },
    testSetting: function (key) { return request('/settings/test', { method: 'POST', body: { key: key } }); },
    startOAuth: function (provider) {
      return request('/oauth/' + provider + '-start', { method: 'POST', body: {} });
    },
    listAgents: function () { return request('/agents/list'); },
    saveAgent: function (agent) { return request('/agents/save', { method: 'POST', body: agent }); },
    runAgent: function (id) { return request('/agents/run', { method: 'POST', body: { id: id } }); },
    pauseAgent: function (id, hours) { return request('/agents/pause', { method: 'POST', body: { id: id, hours: hours } }); },
    clearStuckAgent: function (id) { return request('/agents/clear-stuck', { method: 'POST', body: { id: id } }); },
    resetAgent: function (id) { return request('/agents/reset', { method: 'POST', body: { id: id } }); },
    getDrafts: function () { return request('/pipeline/drafts'); },
    getEvents: function () { return request('/pipeline/events'); },
    decideDraft: function (draftId, action, platforms, opts) { return request('/pipeline/decide', { method: 'POST', body: { draft_id: draftId, action: action, platforms: platforms, skip_image: !!(opts && opts.skip_image) } }); },
    deleteDraft: function (draftId) { return request('/pipeline/delete', { method: 'POST', body: { draft_id: draftId } }); },
    regenerateImage: function (draftId) { return request('/pipeline/regenerate-image', { method: 'POST', body: { draft_id: draftId } }); },
    editDraft: function (draftId, fields) { return request('/pipeline/edit-draft', { method: 'POST', body: Object.assign({ draft_id: draftId }, fields) }); },
    tweakDraft: function (draftId, instruction) { return request('/pipeline/tweak-draft', { method: 'POST', body: { draft_id: draftId, instruction: instruction } }); },
    runPipeline: function () { return request('/pipeline/run-all', { method: 'POST', body: {} }); },
  };

  window.paSession = { get: getSession, set: setSession };
})();
