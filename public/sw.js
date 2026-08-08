/*
 * Service Worker for Ngân Hà Spa Management
 * Handles Web Push Notifications + Offline Cache + Keep-Alive
 */

// 🔧 SW CONFIGURATION
const CACHE_NAME = 'ngan-ha-spa-v1';
const OFFLINE_URLS = [
  '/',
  '/ktv',
  '/login',
  '/icon.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// ─── INSTALL: Pre-cache app shell ───────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Install — caching app shell');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(OFFLINE_URLS).catch((err) => {
        console.warn('[SW] Some URLs failed to cache (non-critical):', err);
      });
    })
  );
  // Activate immediately without waiting for old SW to finish
  self.skipWaiting();
});

// ─── ACTIVATE: Clean up old caches ─────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate — cleaning old caches');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
    })
  );
  // Take control of all open clients immediately
  self.clients.claim();
});

// ─── FETCH: Network-first with cache fallback ──────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests & same-origin
  if (request.method !== 'GET') return;

  // Skip API routes & Supabase calls — always go to network
  const url = new URL(request.url);
  
  // Ignore non-HTTP(S) schemes (e.g., chrome-extension://)
  if (!url.protocol.startsWith('http')) return;

  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Clone and cache successful responses for navigation & static assets
        if (response.ok && (request.mode === 'navigate' || request.destination === 'script' || request.destination === 'style' || request.destination === 'image')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed — try cache
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // For navigation requests, serve the cached root page as fallback
          if (request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});

// ─── PUSH: Handle push notifications ───────────────────────────
self.addEventListener('push', (event) => {
  console.log('[SW] Push Received.');
  let data = { title: 'Ngân Hà Spa', body: 'Bạn có thông báo mới!' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Ngân Hà Spa', body: event.data.text() };
    }
  }

  const options = {
    body: data.body,
    icon: '/icon.png',
    badge: '/icon.png',
    vibrate: [200, 100, 200],
    // 🔧 iOS improvements: tag + renotify ensures each notification is shown separately
    tag: 'ngan-ha-' + Date.now(),
    renotify: true,
    silent: false,
    data: {
      url: data.url || '/',
    },
    actions: [{ action: 'open', title: 'Xem chi tiết' }],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// ─── NOTIFICATION CLICK: Focus or open window ──────────────────
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click Received.');
  event.notification.close();

  const targetUrl = event.notification.data.url;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it and navigate
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if ('focus' in client) {
          client.focus();
          if (client.url !== targetUrl) {
            client.navigate(targetUrl);
          }
          return;
        }
      }
      // Otherwise, open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ─── PERIODIC SYNC: Keep SW alive in background ─────────────────
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'keep-alive') {
    console.log('[SW] Periodic sync: keep-alive ping');
    // Just keep the SW alive — no heavy work needed
    event.waitUntil(Promise.resolve());
  }
});
