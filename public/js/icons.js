(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});

  function svg(paths) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }

  Nexus.icons = Object.freeze({
    home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>'),
    cube: svg('<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5"/><path d="M12 12v10"/>'),
    layers: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>'),
    hammer: svg('<path d="m14 3 7 7-3 3-7-7z"/><path d="M11 6 4 13l7 7 7-7"/><path d="m3 21 4-4"/>'),
    puzzle: svg('<path d="M9 3h3v2.5a1.5 1.5 0 0 0 3 0V3h3v4h2.5v3H18a1.5 1.5 0 0 0 0 3h2.5v5H15v-2.5a1.5 1.5 0 0 0-3 0V18H9v-4H6.5a1.5 1.5 0 0 1 0-3H9V7H6.5V3H9z"/>'),
    palette: svg('<path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h3a5 5 0 0 0 5-5c0-2.8-3.6-5-8-5z"/><circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1" fill="currentColor" stroke="none"/>'),
    ram: svg('<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 17v3M12 17v3M17 17v3M7 10v4M12 10v4M17 10v4"/>'),
    java: svg('<path d="M4 8h11v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M15 10h2a3 3 0 0 1 0 6h-2"/><path d="M7 3c0 1.2 1.8 1.2 1.8 2.4M11 3c0 1.2 1.8 1.2 1.8 2.4"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>'),
    play: svg('<path d="M8 5 19 12 8 19z" fill="currentColor" stroke="none"/>'),
    stop: svg('<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
    shield: svg('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
    check: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>'),
    alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>'),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    download: svg('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    folder: svg('<path d="M3 6h6l2 2h10v11H3z"/><path d="M3 6v11"/>'),
    copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
    refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 6.4"/><path d="M20 4v7h-7"/>'),
    upload: svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 19h16"/>'),
    trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>'),
    eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    swords: svg('<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="m14.5 6.5 3-3H21v3.5l-3 3"/><path d="m5 14 4 4"/><path d="m7 17-3 3"/><path d="m3 19 2 2"/>'),
    gauge: svg('<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>'),
    power: svg('<path d="M12 2v10"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>'),
    help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.8.8c0 1.7-2.3 2.1-2.3 3.7"/><path d="M12 17h.01"/>'),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>'),
    pack: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none"/><path d="m21 15-5-5-6 6-3-3-4 4"/>')
  });
})();
