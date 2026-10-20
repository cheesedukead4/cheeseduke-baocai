/* 離線快取：網站檔案先走網路（略過瀏覽器的 HTTP 快取，確保拿到最新版；檔案沒變時伺服器只回 304），4 秒沒回應或失敗才用快取。雲端資料請求不經過快取。 */
var CACHE = 'cms-app-v28';
var NET_TIMEOUT_MS = 4000;
var ASSETS = [
  './', './index.html', './config.js', './manifest.webmanifest',
  './css/legacy.css', './css/app.css', './css/ext.css',
  './js/auth.js', './js/cloud-sync.js', './js/calc-rules.js', './js/stock-calc.js', './js/access.js', './js/app-shell.js', './js/old-orders-import.js',
  './js/ext/ext-core.js', './js/ext/page-season.js', './js/ext/season-items.js', './js/ext/page-legacy-forecast.js', './js/ext/page-orders.js', './js/ext/page-floor.js', './js/ext/page-system.js', './js/ext/home-dash.js', './js/ext/order-singles.js',
  './js/ext/calc-docs.js', './js/ext/page-rules.js', './js/ext/page-users.js', './js/ext/page-hqstock.js',
  './js/legacy-1.js', './js/legacy-2.js', './js/legacy-3.js', './js/legacy-4.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); }));
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
    var net = fetch(req, { cache: 'no-cache' }).then(function (res) {
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
