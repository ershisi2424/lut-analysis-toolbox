(function () {
  'use strict';

  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;

  var reloadKey = 'lut_toolbox_sw_reload';
  var reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (reloading || sessionStorage.getItem(reloadKey) === '1') return;
    reloading = true;
    sessionStorage.setItem(reloadKey, '1');
    location.reload();
  });

  navigator.serviceWorker.register('./sw.js?v=20260904-5').then(function (registration) {
    return registration.update();
  }).catch(function (error) {
    console.warn('离线缓存初始化失败：', error);
  });

  window.addEventListener('load', function () {
    setTimeout(function () { sessionStorage.removeItem(reloadKey); }, 2000);
  });
})();
