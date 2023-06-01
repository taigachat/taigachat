self.addEventListener('install', _event => {
  self.skipWaiting();
})

self.addEventListener('fetch', function(event) {
    /** @type {Request} */
    const request = event.request
    if (request.url.indexOf('attachment') !== -1 ||
        request.headers.get('accept') === 'text/event-stream') {
        // Since web-workers seem to die after 30 seconds in FireFox, we must
        // let the browser take control of the event-stream.
        return
    }
    event.respondWith(
        caches.match(request).then(function(response) {
            if (response) {
                return response;
            }
            return fetch(request);
        })
    )
})

