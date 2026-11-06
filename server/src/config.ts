import "dotenv/config";

/**
 * Every environment variable the server reads is read here, once, at startup.
 *
 * Two reasons for one file: the process fails immediately with a clear message
 * if something is missing (instead of a confusing error on the first request),
 * and nothing anywhere else in the code touches process.env, so there is one
 * place to look when a deployment behaves differently from your laptop.
 *
 * Nothing in this file has a secret in it. Secrets live in server/.env locally
 * and in the Render dashboard in production.
 */

/** Reads a variable, accepting an older name as a fallback. */
function readEnv(name: string, olderName?: string): string | undefined {
  const value = process.env[name] ?? (olderName ? process.env[olderName] : undefined);
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function requireEnv(name: string, olderName: string | undefined, hint: string): string {
  const value = readEnv(name, olderName);
  if (!value) {
    throw new Error(`${name} is missing. ${hint}`);
  }
  return value;
}

const ENV_FILE_HINT =
  "Locally: copy server/.env.example to server/.env and fill it in. On Render: add it under Environment.";

// MONGO_URI is the name used on Render. MONGODB_URI is accepted too, so an
// older local .env file keeps working.
export const MONGO_URI = requireEnv("MONGO_URI", "MONGODB_URI", ENV_FILE_HINT);

export const DB_NAME = readEnv("DB_NAME") ?? "bloodlink";

export const JWT_SECRET = requireEnv(
  "JWT_SECRET",
  undefined,
  `${ENV_FILE_HINT} Use a long random string; anyone who knows it can forge a login token.`
);

export const JWT_EXPIRES_IN = readEnv("JWT_EXPIRES_IN") ?? "7d";

// Render injects PORT and expects the server to listen on exactly that port.
// Hard-coding a port is the most common reason a Render deploy never goes live.
export const PORT = Number(readEnv("PORT") ?? 5000);

export const NODE_ENV = readEnv("NODE_ENV") ?? "development";
export const IS_PRODUCTION = NODE_ENV === "production";

/**
 * CLIENT_URL is a comma-separated list, so one deployment can allow the Vercel
 * site and a laptop at the same time:
 *
 *   CLIENT_URL=http://localhost:5173,https://bloodlink.vercel.app
 *
 * An entry may also start with "*." to allow a whole subdomain, which is handy
 * for Vercel preview deployments:
 *
 *   CLIENT_URL=https://bloodlink.vercel.app,*.vercel.app
 */
export const ALLOWED_ORIGINS: string[] = (readEnv("CLIENT_URL", "CLIENT_ORIGIN") ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, "")) // a trailing slash never matches
  .filter((origin) => origin.length > 0);

/**
 * True when the browser origin is on the list. An absent origin is allowed:
 * curl, Postman and the Render health check send no Origin header, and CORS is
 * about protecting browser users, not about blocking tools.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;

  const candidate = origin.replace(/\/$/, "");

  return ALLOWED_ORIGINS.some((allowed) => {
    if (allowed === "*") return true;
    if (allowed.startsWith("*.")) {
      // "*.vercel.app" matches https://anything.vercel.app
      const suffix = allowed.slice(1); // ".vercel.app"
      try {
        return new URL(candidate).hostname.endsWith(suffix);
      } catch {
        return false;
      }
    }
    return allowed === candidate;
  });
}

/** Printed once at startup, so the logs show what the process actually read. */
export function describeConfig(): string {
  const host = (() => {
    try {
      return new URL(MONGO_URI.replace("mongodb+srv://", "https://").replace("mongodb://", "http://"))
        .hostname;
    } catch {
      return "unknown host";
    }
  })();

  return [
    `environment   : ${NODE_ENV}`,
    `port          : ${PORT}`,
    `database      : ${DB_NAME} on ${host}`,
    `allowed origins: ${ALLOWED_ORIGINS.join(", ")}`,
  ].join("\n");
}
