(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, note, pageHead, settingsTabs } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const val = Nexus.i18n.t(key, vars);
      if (val !== key || fallback === undefined) return val;
    }
    return fallback !== undefined ? fallback : key;
  }

  Nexus.views.accounts = function (state) {
    const auth = state.auth || {};
    const profile = auth.profile || null;
    const clientId = (state.config.microsoft && state.config.microsoft.clientId) || '';

    return `
      <div class="page">
        ${settingsTabs('accounts')}
        ${pageHead(
          t('accounts.eyebrow'),
          t('accounts.title'),
          t('accounts.sub')
        )}

        <section class="account-hero">
          <div class="account-avatar"><span data-icon="${profile ? 'check' : 'user'}"></span></div>
          <div>
            <h3>${profile ? escapeHtml(profile.name) : escapeHtml(t('accounts.none'))}</h3>
            <p>${profile
              ? `UUID: ${escapeHtml(profile.id || '—')}`
              : escapeHtml(t('accounts.noneDesc'))}</p>
          </div>
          ${profile
            ? `<button type="button" class="btn btn-sm btn-danger" data-action="ms-logout">${escapeHtml(t('accounts.signOut'))}</button>`
            : `<button type="button" class="btn btn-primary btn-sm" data-action="ms-login">${escapeHtml(t('accounts.signIn'))}</button>`}
        </section>

        <div class="auth-layout">
          <section class="panel">
            <div class="panel-head">
              <div>
                <h3>${escapeHtml(t('accounts.clientIdTitle'))}</h3>
                <p>${escapeHtml(t('accounts.clientIdSub'))}</p>
              </div>
            </div>
            <div class="form-stack">
              <div class="field">
                <label for="ms-client-id">Azure / Entra Client ID (UUID)</label>
                <input type="text" id="ms-client-id" placeholder="00000000-0000-0000-0000-000000000000" value="${escapeHtml(clientId)}">
              </div>
              <div class="auth-actions">
                <button type="button" class="btn btn-sm" data-action="save-client-id">${escapeHtml(t('accounts.saveClientId'))}</button>
                ${auth.canRestore ? `<button type="button" class="btn btn-sm" data-action="ms-restore">${escapeHtml(t('accounts.restore'))}</button>` : ''}
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <h3>${escapeHtml(t('accounts.storageTitle'))}</h3>
                <p>${escapeHtml(t('accounts.storageSub'))}</p>
              </div>
            </div>
            <p class="auth-meta"><strong>Backend:</strong> <code>${escapeHtml(auth.storageBackend || 'local')}</code></p>
            <p class="auth-meta" style="margin-top:6px;"><strong>Redirect URI:</strong> <code>${escapeHtml(auth.redirectUri || 'http://127.0.0.1/callback')}</code></p>
          </section>
        </div>

        ${note(t('accounts.note'))}
      </div>`;
  };
})();
