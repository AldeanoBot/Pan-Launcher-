(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatRam(mb) {
    const n = Number(mb);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n >= 1024) {
      const gb = n / 1024;
      return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
    }
    return `${Math.round(n)} MB`;
  }

  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let idx = 0;
    let val = n;
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024;
      idx += 1;
    }
    return `${idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function requiredJavaForVersion(versionId) {
    const id = String(versionId || '').trim();
    if (!id) return 21;
    // Mojang 2026+ CalVer (26.1, 26.2, 26.3, 27.x, etc.) requires Java 25+
    const calver = id.match(/^(\d{2,})\.(\d+)(?:\.(\d+))?/);
    if (calver && Number(calver[1]) >= 26) return 25;
    // Weekly snapshots from 26w... use Java 25; 24w14a+/25w... use Java 21
    const snap = id.match(/^(\d{2})w(\d{2})/);
    if (snap) {
      const yr = Number(snap[1]);
      const wk = Number(snap[2]);
      if (yr >= 26) return 25;
      if (yr > 24 || (yr === 24 && wk >= 14)) return 21;
      if (yr >= 21) return 17;
      return 8;
    }
    const sem = id.match(/1\.(\d+)(?:\.(\d+))?/);
    if (sem) {
      const minor = Number(sem[1]);
      const patch = Number(sem[2] || 0);
      if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
      if (minor >= 17) return 17;
      return 8;
    }
    return 21;
  }

  function note(text) {
    return `<div class="note"><span data-icon="shield"></span><span>${text}</span></div>`;
  }

  function pageHead(eyebrow, title, subtitle, extraHtml) {
    return `
      <header class="page-head">
        <div>
          <span class="eyebrow">${escapeHtml(eyebrow)}</span>
          <h2>${escapeHtml(title)}</h2>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        </div>
        ${extraHtml || ''}
      </header>`;
  }

  const SETTINGS_TABS = Object.freeze([
    { view: 'settings', label: 'General', icon: 'gear' },
    { view: 'ram', label: 'Memoria RAM', icon: 'ram' },
    { view: 'java', label: 'Java', icon: 'java' },
    { view: 'accounts', label: 'Microsoft', icon: 'user' },
    { view: 'fabric', label: 'Fabric', icon: 'puzzle' },
    { view: 'forge', label: 'Forge / NeoForge', icon: 'hammer' }
  ]);

  function settingsTabs(activeView) {
    return `
      <div class="settings-tabs" role="tablist" aria-label="Subsecciones de configuración">
        ${SETTINGS_TABS.map((tab) => {
          const isActive = tab.view === activeView;
          return `
            <button type="button" class="settings-tab${isActive ? ' active' : ''}"
                    role="tab" aria-selected="${isActive}"
                    data-action="navigate" data-view="${tab.view}">
              <span class="nav-icon" data-icon="${tab.icon}"></span>
              <span>${escapeHtml(tab.label)}</span>
            </button>`;
        }).join('')}
      </div>`;
  }

  function hydrateIcons(container) {
    if (!container || !Nexus.icons) return;
    const nodes = container.querySelectorAll('[data-icon]');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const name = el.getAttribute('data-icon');
      const markup = Nexus.icons[name];
      if (markup && el.innerHTML !== markup) {
        el.innerHTML = markup;
      }
    }
  }

  function toast(message, type) {
    const root = document.getElementById('toast-root');
    if (!root || !message) return;
    while (root.children.length >= 4) {
      root.removeChild(root.firstChild);
    }
    const kind = type === 'error' ? 'error' : 'info';
    const iconName = kind === 'error' ? 'alert' : 'check';
    const item = document.createElement('div');
    item.className = `toast toast-${kind}`;
    item.innerHTML = `<span data-icon="${iconName}"></span><span>${escapeHtml(message)}</span>`;
    hydrateIcons(item);
    root.appendChild(item);
    window.setTimeout(() => {
      item.remove();
    }, 3600);
  }

  Nexus.utils = Object.freeze({
    escapeHtml,
    formatRam,
    formatBytes,
    formatDate,
    requiredJavaForVersion,
    note,
    pageHead,
    settingsTabs,
    hydrateIcons,
    toast
  });
})();
