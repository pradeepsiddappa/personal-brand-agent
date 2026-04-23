// ─────────────────────────────────────────────────────────
// auth.js — magic-link sign-in flow
// Loaded as regular <script>. Depends on api.js (paApi, paSession).
// ─────────────────────────────────────────────────────────

// Handle Supabase magic-link callback (tokens arrive in URL hash)
(function () {
  var hash = window.location.hash;
  if (!hash || hash.indexOf('access_token') === -1) return;
  var params = new URLSearchParams(hash.slice(1));
  var token = params.get('access_token');
  var refresh = params.get('refresh_token');
  var expiresIn = parseInt(params.get('expires_in') || '3600', 10);
  if (token) {
    paSession.set({
      access_token: token,
      refresh_token: refresh,
      expires_at: Date.now() + expiresIn * 1000,
    });
    window.location.replace('/pa');
  }
})();

// If already signed in, skip
(function () {
  var s = paSession.get();
  if (s && s.access_token && s.expires_at > Date.now()) {
    window.location.replace('/pa');
  }
})();

window.authPage = function () {
  return {
    email: '',
    loading: false,
    message: '',
    messageKind: '',
    sendLink: function () {
      var self = this;
      self.loading = true;
      self.message = '';
      paApi.requestMagicLink(self.email).then(function () {
        self.message = 'Check your inbox — a magic link is on the way to ' + self.email;
        self.messageKind = 'ok';
      }).catch(function (e) {
        self.message = e.message || 'Could not send magic link. Try again.';
        self.messageKind = 'err';
      }).finally(function () {
        self.loading = false;
      });
    },
  };
};
