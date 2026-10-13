(() => {
  'use strict';
  const core = document.createElement('script');
  core.src = './app-core.js?build=v1.6.2-20261013-1115';
  core.defer = true;
  core.addEventListener('load', () => {
    const folder = document.createElement('script');
    folder.src = './folder-save.js?build=v1.6.1-20260917';
    folder.defer = true;
    document.head.appendChild(folder);
  }, { once: true });
  document.head.appendChild(core);
})();