(() => {
  'use strict';
  const core = document.createElement('script');
  core.src = './app-core.js?build=meeting-summary-20261124-02';
  core.defer = true;
  core.addEventListener('load', () => {
    const folder = document.createElement('script');
    folder.src = './folder-save.js?build=meeting-summary-20261124-02';
    folder.defer = true;
    document.head.appendChild(folder);
  }, { once: true });
  document.head.appendChild(core);
})();