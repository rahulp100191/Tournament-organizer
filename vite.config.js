import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "images/*"],
      manifest: {
        name: "Rally Tournaments",
        short_name: "Rally",
        description: "Compete. Rank. Get discovered.",
        theme_color: "#143c2d",
        background_color: "#f5f6f1",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,jpg,svg,webp}"],
        maximumFileSizeToCacheInBytes: 4000000,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [{
          urlPattern: ({url,request}) => request.method === 'GET' && url.origin === self.location.origin && /^\/api\/v1\/(events(?:\/[^/]+(?:\/matches)?)?|rankings|categories\/[^/]+\/standings)$/.test(url.pathname),
          handler: 'NetworkFirst',
          options: {cacheName:'rally-public-v1',networkTimeoutSeconds:5,expiration:{maxEntries:40,maxAgeSeconds:86400},cacheableResponse:{statuses:[200]}},
        }],
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  preview: { host: "0.0.0.0", port: 4173 },
});
