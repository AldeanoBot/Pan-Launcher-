(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, pageHead } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  Nexus.views.folderGrid = function (state) {
    const folders = state.folders || {};
    if (folders.error) {
      return `<div class="catalog-warning">${escapeHtml(folders.error)}</div>`;
    }
    const items = folders.items || [];
    if (!items.length) {
      return `
        <div class="empty-state">
          <span class="empty-icon" data-icon="folder"></span>
          <h3>Selecciona una instalación</h3>
          <p>Crea o selecciona una instalación para inspeccionar sus carpetas de mods, mundos, texturas y logs.</p>
          <button type="button" class="btn btn-sm" data-action="navigate" data-view="installations">Ir a Instalaciones</button>
        </div>`;
    }

    return `
      <div class="folder-list">
        ${items.map((item) => `
          <div class="folder-row${item.exists ? '' : ' folder-missing'}">
            <div class="folder-icon"><span data-icon="folder"></span></div>
            <div class="folder-info">
              <strong>${escapeHtml(item.label)}</strong>
              <span class="folder-path">${escapeHtml(item.path)}</span>
              <small>${escapeHtml(item.description || item.reason || '')}</small>
            </div>
            <div class="folder-actions" style="margin-top:0;">
              <button type="button" class="btn btn-xs" data-action="folders-copy" data-key="${escapeHtml(item.key)}">
                <span data-icon="copy"></span> Copiar ruta
              </button>
              <button type="button" class="btn btn-xs" data-action="folders-open" data-key="${escapeHtml(item.key)}">Abrir</button>
            </div>
          </div>`).join('')}
      </div>`;
  };

  Nexus.views.folders = function (state) {
    const list = (state.installations && state.installations.list) || [];
    const selectedId = state.folders && state.folders.installationId;

    return `
      <div class="page">
        ${pageHead(
          'SISTEMA DE ARCHIVOS',
          'Carpetas de la instalación',
          'Accede rápido a mods, mundos, packs de recursos, shaders y registros de la instalación seleccionada.',
          `<div class="header-actions">
             <button type="button" class="btn btn-sm" data-action="navigate" data-view="installations">Volver a Instalaciones</button>
             <button type="button" class="btn btn-sm" data-action="folders-refresh">
               <span data-icon="refresh"></span> Refrescar
             </button>
           </div>`
        )}

        <section class="panel">
          <div class="field" style="max-width:420px;margin-bottom:16px;">
            <label for="folders-installation">Instalación seleccionada</label>
            <select id="folders-installation" ${!list.length ? 'disabled' : ''}>
              ${list.length
                ? list.map((inst) => `<option value="${escapeHtml(inst.id)}"${inst.id === selectedId ? ' selected' : ''}>${escapeHtml(inst.name)} (${escapeHtml(inst.versionId)})</option>`).join('')
                : '<option value="">Sin instalaciones creadas</option>'}
            </select>
          </div>
          <div id="folder-grid">${Nexus.views.folderGrid(state)}</div>
        </section>
      </div>`;
  };
})();
