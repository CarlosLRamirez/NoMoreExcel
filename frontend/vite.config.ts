import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
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
        theme_color: "#2563eb",
        background_color: "#f6f7f9",
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
