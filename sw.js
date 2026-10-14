// Cairn offline support: pages load from the network when online and from the cache when offline.
// Built files have content hashes in their names, so they are served from the cache once stored;
// other files are served from the cache and refreshed in the background.
const CACHE = 'cairn-v1';
const HASHED = /-[\w-]{8}\.(js|css|woff2)$/;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['./', './index.html'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => (k.startsWith('cairn-') || k.startsWith('plancraft-')) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  event.respondWith(caches.open(CACHE).then(cache => cache.match(req).then(hit => {
    if (hit && HASHED.test(url.pathname)) return hit;
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
    if (!hit) return net;
    event.waitUntil(net.catch(() => {}));
    return hit;
  })));
});
