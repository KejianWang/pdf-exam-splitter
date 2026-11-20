// 注意：每次发版必须同步修改 CACHE_NAME 与 APP_VERSION。
// 否则 sw.js 内容不变，浏览器不会触发更新，旧版 app.js / pdf-splitter.js 会被永久缓存（已踩过的坑）。
const APP_VERSION = '1.3.1';
const CACHE_NAME = `pdf-exam-splitter-v${APP_VERSION}`;
const V = `?v=${APP_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  `./styles.css${V}`,
  `./app.js${V}`,
  `./pdf-splitter.js${V}`,
  './manifest.webmanifest',
  './assets/icon.svg',
  './vendor/pdf-lib.min.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target/')) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: false });
    if (cached) return cached;

    if (event.request.mode === 'navigate') {
      const cachedIndex = await caches.match('./index.html');
      if (cachedIndex) return cachedIndex;
    }

    const response = await fetch(event.request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(event.request, response.clone());
    }
    return response;
  })());
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('pdf').filter((item) => item instanceof File);
    const file = files[0];
    if (file) {
      await saveSharedFile(file);
    }
  } catch (err) {
    // 失败时仍打开应用主页，让用户手动选择文件。
  }
  return Response.redirect(new URL('./index.html?shared=1', self.registration.scope).href, 303);
}

function openShareDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pdf-exam-splitter-share', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveSharedFile(file) {
  const db = await openShareDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put({ id: 'latest', file, updatedAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}


