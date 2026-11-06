import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // loadEnv reads the .env files for this mode. Passing "" as the prefix loads
  // everything, so the check below sees the variable whether it came from a
  // file or from the host (Vercel injects it as a real environment variable).
  const env = loadEnv(mode, process.cwd(), "");

  // A production build with no VITE_API_URL would succeed and then show a blank
  // page in the browser, because the value is substituted at build time. Fail
  // here instead: the message lands in the Vercel build log where it is useful.
  if (mode === "production" && !env.VITE_API_URL) {
    throw new Error(
      "VITE_API_URL is not set, so this build would not know where the API is.\n" +
        "On Vercel: Settings > Environment Variables > add VITE_API_URL " +
        "(for example https://bloodlink-api.onrender.com), then redeploy.\n" +
        "Locally: set it for one build with\n" +
        '  $env:VITE_API_URL="http://localhost:5000"; npm run build'
    );
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
    },
  };
});
