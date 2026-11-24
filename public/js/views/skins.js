(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, note, pageHead } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  Nexus.views.skinGrid = function (state) {
    const items = (state.skins && state.skins.items) || [];
    if (!items.length) {
      return `
        <div class="empty-state">
          <span class="empty-icon" data-icon="palette"></span>
          <h3>Cargando biblioteca de skins…</h3>
          <p>Importa un archivo PNG 64×64 o 64×32 para añadir tu aspecto personalizado.</p>
        </div>`;
    }

    return `
      <div class="skin-grid">
        ${items.map((skin) => `
          <article class="skin-card${skin.active ? ' active' : ''}">
            <div class="skin-preview"
                 data-skin-id="${escapeHtml(skin.id)}"
                 data-skin-url="${escapeHtml(skin.dataUrl || '')}"
                 data-skin-model="${escapeHtml(skin.model || 'classic')}">
            </div>
            <div class="skin-card-body">
              <div class="skin-card-head">
                <h3>${escapeHtml(skin.name)}</h3>
                <div class="skin-badges">
                  ${skin.active ? '<span class="badge badge-installed">Activa</span>' : ''}
                  <span class="badge">${skin.model === 'slim' ? 'Slim' : 'Clásico'}</span>
                </div>
              </div>
              <p class="skin-meta">${escapeHtml(String(skin.width || 64))}×${escapeHtml(String(skin.height || 64))} · ${skin.source === 'official' ? 'Integrada' : 'Local'}</p>
              <div class="model-switch">
                <button type="button" class="btn btn-xs ${skin.model !== 'slim' ? 'btn-primary' : ''}"
                        data-action="skin-model" data-id="${escapeHtml(skin.id)}" data-model="classic">Clásico</button>
                <button type="button" class="btn btn-xs ${skin.model === 'slim' ? 'btn-primary' : ''}"
                        data-action="skin-model" data-id="${escapeHtml(skin.id)}" data-model="slim">Slim</button>
              </div>
              <div class="skin-actions">
                <button type="button" class="btn btn-sm ${skin.active ? '' : 'btn-primary'}"
                        data-action="skin-select" data-id="${escapeHtml(skin.id)}" ${skin.active ? 'disabled' : ''}>
                  ${skin.active ? 'Seleccionada' : 'Activar skin'}
                </button>
                ${skin.source !== 'official'
                  ? `<button type="button" class="btn btn-sm btn-danger" data-action="skin-remove" data-id="${escapeHtml(skin.id)}">
                       <span data-icon="trash"></span>
                     </button>`
                  : ''}
              </div>
            </div>
          </article>`).join('')}
      </div>`;
  };

  Nexus.views.skins = function (state) {
    const model = (state.skins && state.skins.importModel) || 'classic';

    return `
      <div class="page">
        ${pageHead(
          'PERSONALIZACIÓN',
          'Administrador de skins',
          'Importa archivos PNG 64×64 o 64×32 y alterna entre modelo clásico (Steve 4px) y delgado (Alex 3px).',
          `<button type="button" class="btn btn-sm" data-action="skin-refresh">
             <span data-icon="refresh"></span> Actualizar
           </button>`
        )}

        <section class="panel skin-import-panel">
          <div class="panel-head">
            <div>
              <h3>Importar skin PNG local</h3>
              <p>Se almacena en tu equipo sin subir datos externos.</p>
            </div>
          </div>
          <div class="loader-form-grid">
            <div class="field">
              <label for="skin-import-model">Modelo de brazos</label>
              <select id="skin-import-model">
                <option value="classic"${model === 'classic' ? ' selected' : ''}>Clásico (4 px)</option>
                <option value="slim"${model === 'slim' ? ' selected' : ''}>Slim / Delgado (3 px)</option>
              </select>
            </div>
            <div>
              <button type="button" class="btn btn-primary" data-action="skin-import">
                <span data-icon="upload"></span> Importar PNG…
              </button>
            </div>
          </div>
        </section>

        <section class="skin-section">
          <h3 class="skin-section-title">Biblioteca disponible</h3>
          <div id="skin-grid">${Nexus.views.skinGrid(state)}</div>
        </section>

        ${note('Renderizado ligero estático por fotograma para consumir prácticamente 0 MB de RAM adicional.')}
      </div>`;
  };
})();
