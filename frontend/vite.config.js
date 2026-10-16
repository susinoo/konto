import process from "node:process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // VITE_TAILNET_HOST lives in frontend/.env (never committed, see
  // frontend/.env.example), so no personal hostname ends up in git.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), tailwindcss()],
    server: {
      // Accept connections from the LAN, and from the tailnet when
      // VITE_TAILNET_HOST is set (e.g. testing on a phone over Tailscale).
      host: true,
      allowedHosts: env.VITE_TAILNET_HOST ? [env.VITE_TAILNET_HOST] : [],
      // The whole backend API lives under /api.
      proxy: {
        "/api": "http://localhost:3000",
      },
    },
  };
});
