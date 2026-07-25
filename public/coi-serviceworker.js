/*
 * Cross-origin isolation shim.
 *
 * ONNX Runtime only uses more than one WASM thread when the page is
 * cross-origin isolated, because multi-threading needs SharedArrayBuffer and
 * browsers gate that behind COOP/COEP response headers. Static hosts like
 * GitHub Pages can't set response headers at all, so on a deployed build every
 * model would otherwise run single-threaded — an order of magnitude slower than
 * the same code on a dev server.
 *
 * A service worker can add the headers on the way past, which is what this
 * does. The file is loaded twice: once as a normal page script (which registers
 * it and reloads once so the worker controls the document) and once as the
 * worker itself. `ServiceWorkerGlobalScope` tells the two apart.
 *
 * Only same-origin responses are rewritten. Cross-origin subresources keep
 * whatever headers they came with — every third-party host this app talks to
 * (jsDelivr, huggingface.co, storage.googleapis.com, staticimgly.com) already
 * sends either `Cross-Origin-Resource-Policy: cross-origin` or `ACAO: *`, so
 * they satisfy COEP on their own. If that ever stops being true the symptom is
 * a failed model download, not a silent slowdown.
 */
/* eslint-env serviceworker */
;(function () {
  var isWorker = typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope

  if (isWorker) {
    self.addEventListener('install', function () {
      self.skipWaiting()
    })
    self.addEventListener('activate', function (event) {
      event.waitUntil(self.clients.claim())
    })
    self.addEventListener('fetch', function (event) {
      var request = event.request
      // Range requests served from the HTTP cache can't be re-fetched here.
      if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return

      event.respondWith(
        fetch(request)
          .then(function (response) {
            // Opaque (no-cors cross-origin) responses can't be inspected or
            // rebuilt — pass them straight through.
            if (response.status === 0) return response
            if (new URL(request.url).origin !== self.location.origin) return response

            var headers = new Headers(response.headers)
            headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
            headers.set('Cross-Origin-Opener-Policy', 'same-origin')
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: headers,
            })
          })
          .catch(function (err) {
            console.error('[coi] passthrough failed', err)
            throw err
          }),
      )
    })
    return
  }

  // --- page context -------------------------------------------------------

  if (window.crossOriginIsolated) return // real headers already present
  if (!('serviceWorker' in navigator)) return
  if (window.location.protocol === 'file:') return

  // One reload only. Without this guard a worker that fails to take control
  // (private browsing, a host that strips the headers again) reloads forever.
  var RELOADED = 'coi-reloaded'
  navigator.serviceWorker
    .register(new URL('coi-serviceworker.js', window.location.href), {
      scope: './',
    })
    .then(function (registration) {
      if (registration.active && !navigator.serviceWorker.controller) {
        if (sessionStorage.getItem(RELOADED)) return
        sessionStorage.setItem(RELOADED, '1')
        window.location.reload()
      }
    })
    .catch(function (err) {
      console.warn('[coi] registration failed; models will run single-threaded', err)
    })
})()
