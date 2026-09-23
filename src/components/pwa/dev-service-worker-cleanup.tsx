// Development only. Testing a production build (`npm run start`) on the same localhost
// port registers a service worker; going back to `npm run dev` leaves it serving files
// from that build, and the app dies with "Failed to fetch" on a chunk that no longer
// exists. Because the chunk never loads, React never hydrates, so a cleanup inside a
// component effect never runs either — it has to happen before anything else is fetched,
// which is why this is an inline script in <head>.
const CLEANUP = `
(function () {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    if (registrations.length === 0) return;
    Promise.all(registrations.map(function (r) { return r.unregister(); }))
      .then(function () {
        if (!("caches" in window)) return null;
        return caches.keys().then(function (names) {
          return Promise.all(names.map(function (name) { return caches.delete(name); }));
        });
      })
      .then(function () {
        // The page it served may already be stale, so load it again — once.
        if (sessionStorage.getItem("dev-sw-cleared")) return;
        sessionStorage.setItem("dev-sw-cleared", "1");
        location.reload();
      });
  });
})();
`;

export function DevServiceWorkerCleanup() {
  return <script id="dev-sw-cleanup" dangerouslySetInnerHTML={{ __html: CLEANUP }} />;
}
