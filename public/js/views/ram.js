(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatRam, note, pageHead, settingsTabs } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  const RAM_PRESETS = [2048, 3072, 4096, 6144, 8192, 12288];

  Nexus.views.ram = function (state) {
    const launch = state.config.launch || {};
    const ramMb = Number(launch.ramMb) || 4096;
    const minRamMb = Number(launch.minRamMb) || 512;
    const rec = (state.performance && state.performance.active) || null;

    return `
      <div class="page">
        ${settingsTabs('ram')}
        ${pageHead(
          'MEMORIA JVM',
          'Configuración de RAM',
          'Asigna la memoria máxima (-Xmx) e inicial (-Xms) para Minecraft sin ahogar el sistema operativo.'
        )}

        <section class="panel">
          <div class="ram-display">
            <strong id="ram-value" class="tabular">${escapeHtml(formatRam(ramMb))}</strong>
            <span>asignados a Minecraft (-Xmx)</span>
          </div>
          <div style="margin:14px 0;">
            <label class="sr-only" for="ram-range">RAM máxima de Minecraft</label>
            <input type="range" id="ram-range" min="1024" max="16384" step="512" value="${Math.min(16384, Math.max(1024, ramMb))}">
            <div class="range-labels tabular">
              <span>1 GB</span>
              <span>4 GB (Recomendado PvP)</span>
              <span>8 GB</span>
              <span>16 GB</span>
            </div>
          </div>

          <div class="preset-row">
            ${RAM_PRESETS.map((mb) => `
              <button type="button" class="btn btn-sm ${ramMb === mb ? 'btn-primary' : ''}"
                      data-action="set-ram" data-ram="${mb}">${escapeHtml(formatRam(mb))}</button>`).join('')}
          </div>
        </section>

        ${rec ? `
          <section class="panel">
            <div class="panel-head">
              <div>
                <h3>Recomendación inteligente para tu equipo</h3>
                <p>Calculada según tu memoria disponible y la versión activa (${escapeHtml(launch.versionId)}).</p>
              </div>
              <button type="button" class="btn btn-outline-accent btn-sm"
                      data-action="apply-ram-recommendation"
                      data-ram="${escapeHtml(String(rec.recommendedMaxMb))}"
                      data-min-ram="${escapeHtml(String(rec.recommendedMinMb))}">
                Aplicar recomendado (${escapeHtml(formatRam(rec.recommendedMaxMb))})
              </button>
            </div>
            <p class="ram-recommendation">
              <strong>Sugerido:</strong> ${escapeHtml(formatRam(rec.recommendedMaxMb))} máx. · ${escapeHtml(formatRam(rec.recommendedMinMb))} inicial
            </p>
            <ul class="feature-list">
              ${(rec.reasons || []).map((r) => `<li>${escapeHtml(r)}</li>`).join('')}
            </ul>
          </section>` : ''}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Memoria inicial (-Xms)</h3>
              <p>Se reserva al arrancar la JVM. Recomendado: 512 MB o 1024 MB.</p>
            </div>
          </div>
          <div class="loader-form-grid" style="max-width:420px;">
            <div class="field">
              <label for="min-ram">RAM inicial (MB)</label>
              <input type="number" id="min-ram" min="256" max="8192" step="128" value="${escapeHtml(String(minRamMb))}">
            </div>
            <div>
              <button type="button" class="btn btn-sm" data-action="save-min-ram">Guardar RAM inicial</button>
            </div>
          </div>
        </section>

        ${note('Consejo FPS: en Minecraft Vanilla/Fabric PvP, asignar entre 3 GB y 6 GB es más estable que asignar demasiado heap (evita pausas de recolección largas).')}
      </div>`;
  };
})();
