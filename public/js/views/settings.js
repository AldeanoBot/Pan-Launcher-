(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatRam, note, pageHead, settingsTabs } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  const PROFILE_LABELS = Object.freeze({
    legacy: 'Minecraft antiguo / Java 8',
    modernVanilla: 'Vanilla moderno',
    fabric: 'Fabric',
    forge: 'Forge',
    neoforge: 'NeoForge'
  });

  function hardwarePanel(state) {
    const performance = (state && state.performance) || {};
    const hw = performance.hardware || {};
    const profiles = performance.profiles || {};
    const rows = Object.entries(PROFILE_LABELS).map(([key, label]) => {
      const advice = profiles[key];
      if (!advice) return '';
      return `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(formatRam(advice.recommendedMaxMb))} máx. · ${escapeHtml(formatRam(advice.recommendedMinMb))} inicial · ${escapeHtml(advice.generation === 'legacy' ? 'legacy' : 'moderno')}</li>`;
    }).join('');

    return `
      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>Hardware detectado</h3>
            <p>Datos leídos localmente con Node.js. No se envían a ningún servidor.</p>
          </div>
          <span class="badge badge-release">Local</span>
        </div>
        <div class="hardware-grid">
          <span><strong>CPU</strong> ${escapeHtml(hw.cpuModel || 'No disponible')}</span>
          <span><strong>Núcleos lógicos</strong> ${escapeHtml(String(hw.logicalCores || '—'))}</span>
          <span><strong>RAM total</strong> ${escapeHtml(hw.totalRamMb ? formatRam(hw.totalRamMb) : 'No disponible')}</span>
          <span><strong>RAM disponible</strong> ${escapeHtml(hw.availableRamMb ? formatRam(hw.availableRamMb) : 'No disponible')}</span>
          <span><strong>Sistema</strong> ${escapeHtml(hw.platform || '—')} ${escapeHtml(hw.arch || '')} ${escapeHtml(hw.osRelease || '')}</span>
          <span><strong>Perfil detectado</strong> ${escapeHtml(hw.tier || 'desconocido')}</span>
        </div>
        <p class="field-hint">El navegador no puede leer estos datos directamente: Pan Launcher los obtiene en el proceso principal sin sondeos en segundo plano.</p>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>Recomendaciones conservadoras de RAM</h3>
            <p>Valores orientativos calculados para este equipo; no sobrescriben la memoria configurada.</p>
          </div>
        </div>
        <ul class="feature-list">${rows}</ul>
      </section>`;
  }

  Nexus.views.settings = function (state) {
    const language = state.config.general.language;
    const closeBehavior = state.config.general.closeBehavior || 'quit';

    return `
      <div class="page">
        ${settingsTabs('settings')}
        ${pageHead('AJUSTES', 'Configuración general',
          'Preferencias de la aplicación. Los cambios se escriben de forma segura en un archivo JSON dentro del directorio de datos de Pan Launcher.')}

        <section class="panel">
          <div class="settings-row">
            <div>
              <h4>Tema</h4>
              <p>Tema oscuro Pan Dorado con acentos cálidos en ámbar y tipografía Outfit.</p>
            </div>
            <span class="badge badge-release">Activo</span>
          </div>
          <div class="settings-row">
            <div>
              <h4>Idioma</h4>
              <p>Idioma de la interfaz.</p>
            </div>
            <div class="field">
              <label class="sr-only" for="language-select">Idioma</label>
              <select id="language-select">
                <option value="es"${language === 'es' ? ' selected' : ''}>Español</option>
                <option value="en"${language === 'en' ? ' selected' : ''}>English</option>
              </select>
            </div>
          </div>
          <div class="settings-row">
            <div>
              <h4>Al iniciar Minecraft (estilo SKLauncher)</h4>
              <p>Cerrar el launcher al entrar al juego libera toda la RAM del navegador para exprimir más FPS.</p>
            </div>
            <div class="field">
              <label class="sr-only" for="close-behavior-select">Comportamiento al iniciar Minecraft</label>
              <select id="close-behavior-select">
                <option value="quit"${closeBehavior === 'quit' ? ' selected' : ''}>Cerrar launcher al jugar</option>
                <option value="minimize"${closeBehavior === 'minimize' ? ' selected' : ''}>Minimizar al jugar</option>
                <option value="keep"${closeBehavior === 'keep' ? ' selected' : ''}>Mantener abierto</option>
              </select>
            </div>
          </div>
          <div class="settings-row">
            <div>
              <h4>Modo PC de baja gama</h4>
              <p>Reduce animaciones, brillos y el número inicial de elementos renderizados. No desactiva funciones ni seguridad; la paginación sigue permitiendo acceder a todo el catálogo.</p>
            </div>
            <label class="low-end-toggle">
              <input type="checkbox" id="low-end-toggle"${state.config.general.lowEndMode ? ' checked' : ''}>
              <span>Activado</span>
            </label>
          </div>
        </section>

        ${hardwarePanel(state)}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Datos locales</h3>
              <p>Restaura los ajustes a sus valores iniciales.</p>
            </div>
          </div>
          <button type="button" class="btn" data-action="reset-config">Restablecer configuración</button>
        </section>

        ${note('La configuración se valida en el proceso principal: las claves desconocidas o los valores incorrectos se rechazan.')}
      </div>`;
  };
})();
