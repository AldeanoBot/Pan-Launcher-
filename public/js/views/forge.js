(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  Nexus.views = Nexus.views || {};

  Nexus.views.forge = function (state) {
    const cur = state.loaders && state.loaders.loader;
    const kind = cur === 'neoforge' || cur === 'quilt' ? cur : 'forge';
    return Nexus.views.renderLoaderPage(state, 'forge', kind);
  };
})();
