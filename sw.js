// Service worker MejiK (solo PWA web): mette in cache l'app per l'uso offline.
// Cambia CACHE quando ripubblichi per forzare l'aggiornamento.
const CACHE = 'mejik-v3';

// File piccoli del "guscio" app, messi in cache subito.
const CORE = [
  './', 'index.html', 'styles.css', 'manifest.json',
  'tesseract/tesseract.min.js',
  'js/phash.js', 'js/imagematch.js', 'js/scryfall.js', 'js/ocr.js',
  'js/moxfield.js', 'js/store.js', 'js/app.js', 'js/life.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Solo richieste GET dello stesso sito: API/CDN (Scryfall) passano dirette (dati freschi).
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      // cache "a richiesta" anche degli asset grossi (OCR, database immagine)
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return resp;
    }).catch(() => hit))
  );
});
