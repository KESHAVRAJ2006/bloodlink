/**
 * Where the API lives. Read once, from one place.
 *
 * Why the VITE_ prefix is compulsory: Vite does not hand the browser your whole
 * environment, because that would leak anything else in it. Only variables
 * whose name starts with VITE_ are exposed on import.meta.env, and they are
 * substituted into the bundle **at build time** - they are not read when the
 * page loads. Two consequences worth remembering:
 *
 *   1. Changing VITE_API_URL on Vercel does nothing until you redeploy, because
 *      the old value is already baked into the built JavaScript.
 *   2. Never put a secret in a VITE_ variable. It ends up in a file that anyone
 *      can read with View Source. Secrets belong on the server (Render).
 *
 * Locally the value comes from client/.env.development, which is committed
 * because it contains no secret. In production Vercel supplies it.
 */
const configuredApiUrl = import.meta.env.VITE_API_URL;

if (!configuredApiUrl) {
  // Thrown at startup rather than on the first fetch, so the cause is obvious.
  throw new Error(
    "VITE_API_URL is not set. Locally: copy client/.env.example to client/.env.development. " +
      "On Vercel: add it under Settings > Environment Variables and redeploy."
  );
}

/** No trailing slash, so `${API_URL}/api/health` never becomes a double slash. */
export const API_URL = configuredApiUrl.replace(/\/$/, "");

/** Optional: the embed URL of the MongoDB Atlas chart on the dashboard. */
export const ATLAS_CHART_URL = import.meta.env.VITE_ATLAS_CHART_URL ?? "";
