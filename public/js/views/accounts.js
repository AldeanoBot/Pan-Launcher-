(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, note, pageHead, settingsTabs } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  Nexus.views.accounts = function (state) {
    const auth = state.auth || {};
    const profile = auth.profile || null;
    const clientId = (state.config.microsoft && state.config.microsoft.clientId) || '';

    return `
      <div class="page">
        ${settingsTabs('accounts')}
        ${pageHead(
          'AUTENTICACIÓN',
          'Cuentas Microsoft',
          'Inicia sesión con tu cuenta oficial de Microsoft para servidores premium o alterna a Modo Offline en Jugadores.'
        )}

        <section class="account-hero">
          <div class="account-avatar"><span data-icon="${profile ? 'check' : 'user'}"></span></div>
          <div>
            <h3>${profile ? escapeHtml(profile.name) : 'Sin cuenta Microsoft conectada'}</h3>
            <p>${profile
              ? `UUID: ${escapeHtml(profile.id || '—')}`
              : 'Conecta tu cuenta oficial o usa un perfil local sin conexión en la pestaña Jugadores.'}</p>
          </div>
          ${profile
            ? '<button type="button" class="btn btn-sm btn-danger" data-action="ms-logout">Cerrar sesión</button>'
            : `<button type="button" class="btn btn-primary btn-sm" data-action="ms-login">Iniciar con Microsoft</button>`}
        </section>

        <div class="auth-layout">
          <section class="panel">
            <div class="panel-head">
              <div>
                <h3>Client ID personalizado (opcional)</h3>
                <p>Solo necesario si utilizas tu propia aplicación registrada en Microsoft Entra ID.</p>
              </div>
            </div>
            <div class="form-stack">
              <div class="field">
                <label for="ms-client-id">Azure / Entra Client ID (UUID)</label>
                <input type="text" id="ms-client-id" placeholder="00000000-0000-0000-0000-000000000000" value="${escapeHtml(clientId)}">
              </div>
              <div class="auth-actions">
                <button type="button" class="btn btn-sm" data-action="save-client-id">Guardar Client ID</button>
                ${auth.canRestore ? '<button type="button" class="btn btn-sm" data-action="ms-restore">Restaurar sesión</button>' : ''}
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <h3>Estado del almacenamiento</h3>
                <p>Detalles locales del entorno actual.</p>
              </div>
            </div>
            <p class="auth-meta"><strong>Backend:</strong> <code>${escapeHtml(auth.storageBackend || 'local')}</code></p>
            <p class="auth-meta" style="margin-top:6px;"><strong>Redirect URI:</strong> <code>${escapeHtml(auth.redirectUri || 'http://127.0.0.1/callback')}</code></p>
          </section>
        </div>

        ${note('¿Solo quieres jugar en servidores no-premium o en local? Ve a Jugadores y selecciona Modo Offline con cualquier nick.')}
      </div>`;
  };
})();
