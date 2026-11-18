// 離線快取：只快取 App 本身（網頁、圖示、supabase-js），資料一律走網路
const V = 'ledger-v6';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'formula.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => Promise.all([c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))), c.add(CDN)])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin !== location.origin && e.request.url !== CDN) return; // 資料庫請求不快取
  // App 本身：有網路就拿最新版（並更新快取），沒網路才用快取；supabase-js 固定版本，直接用快取
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (e.request.url === CDN && hit) return hit;
    try {
      const r = await fetch(e.request, { cache: 'no-cache' });
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch (err) {
      if (hit) return hit;
      throw err;
    }
  }));
});
