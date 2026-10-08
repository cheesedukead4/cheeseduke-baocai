/* 離線快取：網站檔案先走網路（確保拿到最新版），4 秒沒回應或失敗才用快取。雲端資料請求不經過快取。 */
var CACHE = 'cms-app-v3';
var NET_TIMEOUT_MS = 4000;
var ASSETS = [
  './', './index.html', './config.js', './manifest.webmanifest',
  './css/legacy.css', './css/app.css',
  './js/cloud-sync.js', './js/app-shell.js', './js/old-orders-import.js',
  './js/legacy-1.js', './js/legacy-2.js', './js/legacy-3.js', './js/legacy-4.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function cachedFor(req, nav) {
  return caches.match(req, { ignoreSearch: true }).then(function (hit) {
    // 開頁面時一律可退回首頁快取（例如網址帶 ?openExternalBrowser=1，或主機把 /index.html 轉址到 /）
    if (nav && (!hit || hit.redirected)) return caches.match('./');
    return hit;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var nav = req.mode === 'navigate';
  if (url.search && !nav) return;
  e.respondWith(cachedFor(req, nav).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok && !res.redirected && !url.search) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
    if (!hit) return net;
    var slow = new Promise(function (resolve) { setTimeout(function () { resolve(hit); }, NET_TIMEOUT_MS); });
    return Promise.race([net.catch(function () { return hit; }), slow]);
  }));
});
