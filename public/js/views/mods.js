(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, note, pageHead } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  Nexus.views.mods = function (state) {
    const evaluated = Nexus.perfEngine ? Nexus.perfEngine.evaluateFromConfig(state.config) : null;
    const activeMods = evaluated ? evaluated.mods.filter((m) => m.enabled) : [];

    return `
      <div class="page">
        ${pageHead('CONTENIDO', 'Mods y paquetes FPS',
          'Configura la pila de optimización en Rendimiento y PvP para exportar tu .mrpack o abre la carpeta .minecraft/mods de cada instalación aislada.',
          `<div class="header-actions">
             <button type="button" class="btn btn-primary btn-sm" data-action="navigate" data-view="performance">
               <span data-icon="bolt"></span> Ir a Rendimiento y PvP
             </button>
             <button type="button" class="btn btn-sm" data-action="navigate" data-view="installations">
               <span data-icon="folder"></span> Carpetas de instalación
             </button>
           </div>`)}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Mods activos en el perfil actual (${escapeHtml(String(activeMods.length))})</h3>
              <p>Se resuelven directamente desde Modrinth con verificación SHA512 al exportar el paquete.</p>
            </div>
          </div>
          ${activeMods.length
            ? `<ul class="feature-list">
                ${activeMods.map((mod) => `<li><strong>${escapeHtml(mod.name)}</strong> (${escapeHtml(mod.version)}) — ${escapeHtml(mod.description)}</li>`).join('')}
               </ul>`
            : '<p class="muted">Perfil Vanilla puro seleccionado: no hay mods de optimización activos.</p>'}
        </section>

        ${note('Solo se enlazan mods verificados en Modrinth o la carpeta privada de cada instalación aislada.')}
      </div>`;
  };
})();
