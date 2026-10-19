import worker from "../src/worker.js";

/**
 * Cloudflare Pages Functions catch-all handler
 * Routes /api/* and /healthz to the worker logic, and passes other requests to Pages static assets
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);

  // If request is for an API endpoint or healthz, delegate to worker API router
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") {
    return worker.fetch(context.request, context.env, {
      waitUntil: (promise) => context.waitUntil(promise),
      passThroughOnException: () => {}
    });
  }

  // Otherwise, serve static asset via Cloudflare Pages
  return context.next();
}
