/**
 * @fileoverview Workbox service worker for UltiStats.
 * Uses injectManifest mode — Vite injects __WB_MANIFEST at build time.
 */

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';

// ─── Precache app shell (injected by Vite/Workbox at build time) ─────
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ─── API requests: NetworkFirst with 5s timeout, 24h cache ──────────
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxAgeSeconds: 24 * 60 * 60 })
    ]
  })
);

// ─── CDN resources: StaleWhileRevalidate ─────────────────────────────
registerRoute(
  ({ url }) =>
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'unpkg.com' ||
    url.hostname === 'cdn.tailwindcss.com',
  new StaleWhileRevalidate({
    cacheName: 'cdn-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 30 * 24 * 60 * 60 })
    ]
  })
);

// ─── Images/fonts: CacheFirst with 30-day expiry ─────────────────────
registerRoute(
  ({ request }) =>
    request.destination === 'image' ||
    request.destination === 'font',
  new CacheFirst({
    cacheName: 'assets-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 })
    ]
  })
);

// ─── Navigation fallback: NetworkFirst ───────────────────────────────
const navigationHandler = new NetworkFirst({
  cacheName: 'pages-cache',
  networkTimeoutSeconds: 3,
  plugins: [
    new CacheableResponsePlugin({ statuses: [0, 200] })
  ]
});
registerRoute(new NavigationRoute(navigationHandler));

// ─── Background sync (preserved from original sw.js) ─────────────────

self.addEventListener('sync', event => {
  if (event.tag === 'sync-game-data') {
    event.waitUntil(syncGameData());
  }
});

async function syncGameData() {
  // Read from Dexie's pendingSync table via raw IndexedDB
  const SYNC_DB_NAME = 'ultistats';
  const SYNC_STORE = 'pendingSync';

  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(SYNC_DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.log('[SW Sync] Could not open IndexedDB:', err);
    return;
  }

  // Check if the pendingSync store exists
  if (!db.objectStoreNames.contains(SYNC_STORE)) {
    db.close();
    return;
  }

  const pending = await new Promise((resolve) => {
    const tx = db.transaction(SYNC_STORE, 'readonly');
    const store = tx.objectStore(SYNC_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result.filter(r => !r.synced));
    req.onerror = () => resolve([]);
  });

  if (pending.length === 0) {
    db.close();
    return;
  }

  // Mark all as synced
  await new Promise((resolve) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_STORE);
    for (const action of pending) {
      action.synced = 1;
      store.put(action);
    }
    tx.oncomplete = () => resolve();
  });

  db.close();

  // Notify all open clients
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'sync-complete', count: pending.length });
  });
}

// ─── Skip waiting & claim clients ────────────────────────────────────
self.skipWaiting();
self.addEventListener('activate', () => self.clients.claim());
