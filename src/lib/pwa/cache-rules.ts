// What the service worker may keep on the phone: only the app shell (built JS/CSS, fonts, icons).
// Pages, RSC payloads, /api responses and Server Action POSTs are never cached — they can hold
// customer data (master context: "No customer data is cached on the phone").

const SHELL_PATH = /^\/(?:_next\/static\/|icons\/)/;
const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)$/i;

type CacheCheck = { url: URL; request: Request; sameOrigin: boolean };

export function isShellAsset({ url, request, sameOrigin }: CacheCheck): boolean {
  if (!sameOrigin || request.method !== "GET") return false;
  if (url.searchParams.has("_rsc")) return false;
  return SHELL_PATH.test(url.pathname) || FONT_FILE.test(url.pathname);
}

export function isNavigation(request: Request): boolean {
  return request.mode === "navigate" || request.destination === "document";
}
