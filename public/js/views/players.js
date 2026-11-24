(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, note, pageHead } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  Nexus.views.players = function (state) {
    const session = state.session || { mode: 'online', profile: null, locals: [], activeLocalId: null };
    const locals = Array.isArray(session.locals) ? session.locals : [];
    const activeMode = session.mode === 'offline' ? 'offline' : 'online';
    const activeProfile = session.profile || (state.auth && state.auth.profile) || null;

    return `
      <div class="page">
        ${pageHead(
          'IDENTIDAD DE JUGADOR',
          'Modo y jugadores',
          'Elige entre iniciar con tu cuenta oficial de Microsoft (Online) o crear perfiles locales sin conexión (Offline).'
        )}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Modo de sesión</h3>
              <p>Cambia el modo activo antes de pulsar JUGAR.</p>
            </div>
          </div>
          <div class="mode-grid">
            <button type="button" class="mode-card${activeMode === 'online' ? ' active' : ''}"
                    data-action="session-mode" data-mode="online">
              <span class="mode-icon" data-icon="shield"></span>
              <span class="mode-copy">
                <strong>Modo Online (Microsoft)</strong>
                <small>Para servidores oficiales y verificación Xbox Live / Mojang.</small>
              </span>
            </button>

            <button type="button" class="mode-card${activeMode === 'offline' ? ' active' : ''}"
                    data-action="session-mode" data-mode="offline">
              <span class="mode-icon" data-icon="user"></span>
              <span class="mode-copy">
                <strong>Modo Offline (Local)</strong>
                <small>Usa cualquier nombre local sin cuenta Microsoft ni internet.</small>
              </span>
            </button>
          </div>

          <div class="active-session">
            <strong>Sesión actual:</strong>
            <span>${activeProfile ? escapeHtml(activeProfile.name) : 'Sin jugador activo'}</span>
            <code>${activeMode.toUpperCase()}</code>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Perfiles locales (Offline)</h3>
              <p>Crea o renombra tus nicks locales (1–16 caracteres, letras, números o guion bajo).</p>
            </div>
          </div>

          <div class="loader-form-grid" style="max-width:460px;">
            <div class="field">
              <label for="new-player-name">Nuevo jugador local</label>
              <input type="text" id="new-player-name" maxlength="16" placeholder="Ej. PanWarrior">
            </div>
            <div>
              <button type="button" class="btn btn-primary btn-sm" data-action="player-create">
                <span data-icon="plus"></span> Crear perfil
              </button>
            </div>
          </div>

          <div class="player-list">
            ${locals.length
              ? locals.map((player) => {
                  const isActive = session.activeLocalId === player.id;
                  return `
                    <div class="player-row${isActive ? ' active' : ''}">
                      <div class="player-identity">
                        <span class="player-avatar" data-icon="user"></span>
                        <div>
                          <strong>${escapeHtml(player.name)}</strong>
                          <small>${escapeHtml(player.id)}</small>
                        </div>
                      </div>
                      <div class="player-actions">
                        <input type="text" class="player-name-input" maxlength="16"
                               aria-label="Nombre de ${escapeHtml(player.name)}"
                               data-player-name="${escapeHtml(player.id)}"
                               value="${escapeHtml(player.name)}">
                        <button type="button" class="btn btn-xs" data-action="player-save" data-player-id="${escapeHtml(player.id)}">Renombrar</button>
                        <button type="button" class="btn btn-xs ${isActive ? '' : 'btn-primary'}"
                                data-action="player-select" data-player-id="${escapeHtml(player.id)}" ${isActive ? 'disabled' : ''}>
                          ${isActive ? 'Activo' : 'Seleccionar'}
                        </button>
                        <button type="button" class="btn btn-xs btn-danger" data-action="player-remove" data-player-id="${escapeHtml(player.id)}">
                          <span data-icon="trash"></span>
                        </button>
                      </div>
                    </div>`;
                }).join('')
              : '<p class="muted">Todavía no has creado ningún perfil local.</p>'}
          </div>
        </section>

        ${note('En Modo Offline se genera un UUID determinista compatible con servidores locales y no-premium.')}
      </div>`;
  };
})();
