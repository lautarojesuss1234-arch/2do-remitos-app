const CACHE_NAME = "remitos-v2";

// Archivos a cachear para funcionamiento offline
const STATIC_ASSETS = [
  "/2do-remitos-app/",
  "/2do-remitos-app/index.html",
  "/2do-remitos-app/styles.css",
  "/2do-remitos-app/js/app.js",
  "/2do-remitos-app/js/auth.js",
  "/2do-remitos-app/js/config.js",
  "/2do-remitos-app/js/db.js",
  "/2do-remitos-app/js/ui.js",
  "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600&display=swap",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
];

// Instalación: cachear todos los archivos estáticos
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cachear de a uno para no fallar todo si uno falla
      return Promise.allSettled(
        STATIC_ASSETS.map((url) => cache.add(url).catch(() => {}))
      );
    })
  );
  self.skipWaiting();
});

// Activación: limpiar caches viejos
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first para estáticos, network-first para Firebase
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Firebase y APIs de IA → siempre red (datos en tiempo real)
  if (
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("firebase") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("anthropic.com") ||
    url.hostname.includes("openai.com")
  ) {
    return; // dejar pasar sin interceptar
  }

  // Estáticos → cache first, fallback a red
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cachear respuestas válidas de CDN y assets propios
        if (
          response.ok &&
          (url.origin === self.location.origin ||
            url.hostname.includes("cdnjs.cloudflare.com") ||
            url.hostname.includes("fonts.googleapis.com") ||
            url.hostname.includes("fonts.gstatic.com"))
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
