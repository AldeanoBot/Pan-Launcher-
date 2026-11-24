(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  Nexus.views = Nexus.views || {};

  Nexus.views.forge = function (state) {
    const kind = state.loaders && state.loaders.loader === 'neoforge' ? 'neoforge' : 'forge';
    return Nexus.views.renderLoaderPage(state, 'forge', kind);
  };
})();
