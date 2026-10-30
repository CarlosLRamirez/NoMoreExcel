import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "node:child_process";
import pkg from "./package.json";

// Versión visible en la app: package.json + commit. En Docker no hay .git, así que el
// commit llega por el build-arg GIT_SHA (lo pasa el workflow de deploy).
const commit = (() => {
  if (process.env.GIT_SHA) return process.env.GIT_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
})();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "icon-192.png"],
      manifest: {
        name: "NoMoreExcel",
        short_name: "NoMoreExcel",
        description: "Finanzas personales",
        lang: "es",
        theme_color: "#161b22",
        background_color: "#161b22",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // No interceptar la API ni el panel admin de PocketBase con el fallback SPA.
        navigateFallbackDenylist: [/^\/api\//, /^\/_\//],
      },
    }),
  ],
  server: { port: 5173 },
});
