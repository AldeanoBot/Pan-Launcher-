(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, note, pageHead } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const val = Nexus.i18n.t(key, vars);
      if (val !== key || fallback === undefined) return val;
    }
    return fallback !== undefined ? fallback : key;
  }

  Nexus.views.players = function (state) {
    const session = state.session || { mode: 'online', profile: null, locals: [], activeLocalId: null };
    const locals = Array.isArray(session.locals) ? session.locals : [];
    const activeMode = session.mode === 'offline' ? 'offline' : 'online';
    const activeProfile = session.profile || (state.auth && state.auth.profile) || null;

    return `
      <div class="page">
        ${pageHead(
          t('players.eyebrow'),
          t('players.title'),
          t('players.sub')
        )}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('players.modeTitle'))}</h3>
              <p>${escapeHtml(t('players.modeSub'))}</p>
            </div>
          </div>
          <div class="mode-grid">
            <button type="button" class="mode-card${activeMode === 'online' ? ' active' : ''}"
                    data-action="session-mode" data-mode="online">
              <span class="mode-icon" data-icon="shield"></span>
              <span class="mode-copy">
                <strong>${escapeHtml(t('players.onlineTitle'))}</strong>
                <small>${escapeHtml(t('players.onlineSub'))}</small>
              </span>
            </button>

            <button type="button" class="mode-card${activeMode === 'offline' ? ' active' : ''}"
                    data-action="session-mode" data-mode="offline">
              <span class="mode-icon" data-icon="user"></span>
              <span class="mode-copy">
                <strong>${escapeHtml(t('players.offlineTitle'))}</strong>
                <small>${escapeHtml(t('players.offlineSub'))}</small>
              </span>
            </button>
          </div>

          <div class="active-session">
            <strong>${escapeHtml(t('players.currentSession'))}</strong>
            <span>${escapeHtml(activeProfile ? activeProfile.name : t('players.noActivePlayer'))}</span>
            <code>${activeMode.toUpperCase()}</code>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('players.localsTitle'))}</h3>
              <p>${escapeHtml(t('players.localsSub'))}</p>
            </div>
          </div>

          <div class="loader-form-grid" style="max-width:460px;">
            <div class="field">
              <label for="new-player-name">${escapeHtml(t('players.newLabel'))}</label>
              <input type="text" id="new-player-name" maxlength="16" placeholder="${escapeHtml(t('players.newPh'))}">
            </div>
            <div>
              <button type="button" class="btn btn-primary btn-sm" data-action="player-create">
                <span data-icon="plus"></span> ${escapeHtml(t('players.createBtn'))}
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
                               aria-label="${escapeHtml(t('players.renameAria', { name: player.name }))}"
                               data-player-name="${escapeHtml(player.id)}"
                               value="${escapeHtml(player.name)}">
                        <button type="button" class="btn btn-xs" data-action="player-save" data-player-id="${escapeHtml(player.id)}">${escapeHtml(t('players.renameBtn'))}</button>
                        <button type="button" class="btn btn-xs ${isActive ? '' : 'btn-primary'}"
                                data-action="player-select" data-player-id="${escapeHtml(player.id)}" ${isActive ? 'disabled' : ''}>
                          ${escapeHtml(isActive ? t('players.activeBtn') : t('players.selectBtn'))}
                        </button>
                        <button type="button" class="btn btn-xs btn-danger" data-action="player-remove" data-player-id="${escapeHtml(player.id)}" aria-label="${escapeHtml(t('confirm.confirm'))}">
                          <span data-icon="trash"></span>
                        </button>
                      </div>
                    </div>`;
                }).join('')
              : `<p class="muted">${escapeHtml(t('players.emptyLocals'))}</p>`}
          </div>
        </section>

        ${note(t('players.note'))}
      </div>`;
  };
})();
