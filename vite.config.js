import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.svg'],
      manifest: {
        name: 'Nimbus — Radar Weather',
        short_name: 'Nimbus',
        description:
          'Ad-free, radar-focused weather with animated nowcast and long-range outlook.',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: './',
        scope: './',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            // Open-Meteo forecast data — network-first, short cache so the
            // last successful forecast is available offline.
            urlPattern: /^https:\/\/[a-z-]*\.?open-meteo\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'open-meteo',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 6 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // RainViewer radar frame index — always fresh when online.
            urlPattern: /^https:\/\/api\.rainviewer\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'rainviewer-index',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 10 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Radar + base-map tiles — cache-first, they never change once
            // published and are the heaviest payload.
            urlPattern:
              /^https:\/\/(tilecache\.rainviewer\.com|server\.arcgisonline\.com|[a-c]?\.?tile\.openstreetmap\.org|.*\.basemaps\.cartocdn\.com)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 3 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
