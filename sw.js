'use strict';

const CACHE_NAME = 'lut-analysis-toolbox-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './index1.html',
  './index2.html',
  './index3.html',
  './manifest.json',
  './css/style.min.css',
  './css/canvas-size-fix.css',
  './css/analyzer.min.css',
  './css/previewer.min.css',
  './js/auth.js',
  './js/sw-register.js',
  './js/utils.min.js',
  './js/lut-utils.js',
  './js/lutviz.min.js',
  './js/granger.min.js',
  './js/lutanayzer.min.js',
  './js/lutpreviewer.min.js',
  './js/bug-detect.min.js',
  './assets/fonts/bebasneue-v14-regular.woff2',
  './assets/fonts/josefinsans-v25-regular.woff2',
  './assets/fonts/nunito-v25-regular.woff2',
  './vendor/tailwind/index.global.js',
  './vendor/lucide/lucide.min.js',
  './vendor/gsap/gsap.min.js',
  './vendor/gsap/ScrollTrigger.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(response => response || caches.match('./index.html'))));
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
