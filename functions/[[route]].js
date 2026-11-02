import worker, { checkBasicAuth, getAuthConfig } from "../src/worker.js";

/**
 * Cloudflare Pages Functions catch-all handler
 * Routes /api/* and /healthz to the worker logic, and passes other requests to Pages static assets
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;

  // 1. Always delegate /api/* and /healthz to the worker router (which handles /api/auth/* and API auth)
  if (path.startsWith("/api/") || path === "/healthz") {
    return worker.fetch(context.request, context.env, {
      waitUntil: (promise) => context.waitUntil(promise),
      passThroughOnException: () => {}
    });
  }

  // 2. Allow public assets needed by the login screen
  const isPublicAsset = (
    path.startsWith("/static/") ||
    path === "/favicon.ico" ||
    path === "/favicon.png" ||
    path === "/manifest.json" ||
    path === "/sw.js"
  );
  if (isPublicAsset) {
    return context.next();
  }

  const isAuthenticated = await checkBasicAuth(context.request, context.env);
  const { authEnabled, misconfigured } = getAuthConfig(context.env);

  // 3. Handle /login route
  if (path === "/login" || path === "/login.html") {
    if ((!authEnabled && !misconfigured) || isAuthenticated) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/" }
      });
    }
    const loginUrl = new URL("/login.html", context.request.url);
    return context.env.ASSETS.fetch(new Request(loginUrl.toString(), context.request));
  }

  // 4. Redirect unauthenticated users to /login
  if (!isAuthenticated) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/login" }
    });
  }

  // 5. Serve protected static asset via Cloudflare Pages
  return context.next();
}
