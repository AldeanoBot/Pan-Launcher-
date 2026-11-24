(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  Nexus.views = Nexus.views || {};

  Nexus.views.fabric = function (state) {
    return Nexus.views.renderLoaderPage(state, 'fabric', 'fabric');
  };
})();
