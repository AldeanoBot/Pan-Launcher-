(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatRam, note, pageHead, settingsTabs } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const val = Nexus.i18n.t(key, vars);
      if (val !== key || fallback === undefined) return val;
    }
    return fallback !== undefined ? fallback : key;
  }

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
          t('ram.eyebrow'),
          t('ram.title'),
          t('ram.sub')
        )}

        <section class="panel">
          <div class="ram-display">
            <strong id="ram-value" class="tabular">${escapeHtml(formatRam(ramMb))}</strong>
            <span>${escapeHtml(t('ram.assigned'))}</span>
          </div>
          <div style="margin:14px 0;">
            <label class="sr-only" for="ram-range">${escapeHtml(t('ram.rangeAria'))}</label>
            <input type="range" id="ram-range" min="1024" max="16384" step="512" value="${Math.min(16384, Math.max(1024, ramMb))}">
            <div class="range-labels tabular">
              <span>1 GB</span>
              <span>${escapeHtml(t('ram.recPvp'))}</span>
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
                <h3>${escapeHtml(t('ram.smartTitle'))}</h3>
                <p>${escapeHtml(t('ram.smartSub', { ver: launch.versionId }))}</p>
              </div>
              <button type="button" class="btn btn-outline-accent btn-sm"
                      data-action="apply-ram-recommendation"
                      data-ram="${escapeHtml(String(rec.recommendedMaxMb))}"
                      data-min-ram="${escapeHtml(String(rec.recommendedMinMb))}">
                ${escapeHtml(t('ram.applyRec', { ram: formatRam(rec.recommendedMaxMb) }))}
              </button>
            </div>
            <p class="ram-recommendation">
              <strong>${escapeHtml(t('ram.suggested'))}</strong> ${escapeHtml(t('ram.suggestedDetail', { max: formatRam(rec.recommendedMaxMb), min: formatRam(rec.recommendedMinMb) }))}
            </p>
            <ul class="feature-list">
              ${(rec.reasons || []).map((r) => `<li>${escapeHtml(r)}</li>`).join('')}
            </ul>
          </section>` : ''}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('ram.minTitle'))}</h3>
              <p>${escapeHtml(t('ram.minSub'))}</p>
            </div>
          </div>
          <div class="loader-form-grid" style="max-width:420px;">
            <div class="field">
              <label for="min-ram">${escapeHtml(t('ram.minLabel'))}</label>
              <input type="number" id="min-ram" min="256" max="8192" step="128" value="${escapeHtml(String(minRamMb))}">
            </div>
            <div>
              <button type="button" class="btn btn-sm" data-action="save-min-ram">${escapeHtml(t('ram.saveMin'))}</button>
            </div>
          </div>
        </section>

        ${note(t('ram.note'))}
      </div>`;
  };
})();
