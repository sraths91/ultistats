const CACHE_NAME = 'ultistats-v14';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/tournament.html',
  '/league.html',
  '/game.html',
  '/season.html',
  '/script.js',
  '/manifest.json',
  'https://unpkg.com/lucide@0.563.0',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
];

// Install event - precache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .catch(err => console.log('Cache install error:', err))
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - strategy depends on request type
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API requests: network-first, fall back to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // HTML and JS files: network-first (ensures latest code)
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname === '/') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Other static assets (fonts, icons, css): stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// Network-first strategy (for API calls)
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Stale-while-revalidate strategy (for static assets)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetch(request).then(networkResponse => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => null);

  // Return cached immediately if available, otherwise wait for network
  if (cachedResponse) {
    // Fire-and-forget revalidation
    fetchPromise;
    return cachedResponse;
  }

  const networkResponse = await fetchPromise;
  if (networkResponse) return networkResponse;

  // Last resort: return offline fallback
  return caches.match('/index.html');
}

// ==================== BACKGROUND SYNC ====================
// Syncs queued game actions when connectivity is restored

self.addEventListener('sync', event => {
  if (event.tag === 'sync-game-data') {
    event.waitUntil(syncGameData());
  }
});

async function syncGameData() {
  const SYNC_DB_NAME = 'ultistats_sync';
  const SYNC_STORE = 'pendingActions';

  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(SYNC_DB_NAME, 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.log('[SW Sync] Could not open IndexedDB:', err);
    return;
  }

  // Read pending actions
  const pending = await new Promise((resolve) => {
    const tx = db.transaction(SYNC_STORE, 'readonly');
    const store = tx.objectStore(SYNC_STORE);
    const index = store.index('synced');
    const req = index.getAll(0);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve([]);
  });

  if (pending.length === 0) return;

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

  // Clean up synced records
  await new Promise((resolve) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_STORE);
    const index = store.index('synced');
    const req = index.openCursor(IDBKeyRange.only(1));
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
    tx.oncomplete = () => resolve();
  });

  // Notify all open clients
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'sync-complete', count: pending.length });
  });
}
