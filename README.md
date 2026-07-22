# Nimbus — Radar Weather PWA

An **ad-free, radar-first** weather Progressive Web App. Full-screen animated
radar with a precipitation nowcast, a detailed 16-day forecast, and an honest
long-range ensemble outlook. No accounts, no tracking, no API keys — everything
runs client-side and installs to your home screen.

## Features

- **Full-screen animated radar** — past frames + a ~30 min–2 hr precipitation
  nowcast, with play/pause and a scrubbable timeline. Nowcast frames are clearly
  badged `FORECAST`.
- **Current conditions** — temperature, feels-like, humidity, wind, precip.
- **Hourly** — next 24 hours with precip probability.
- **16-day forecast** — daily highs/lows on a shared temperature scale, precip
  chance, and conditions.
- **Long-range Outlook** — a 35-day ensemble view that shows the *spread* of
  forecast members as a widening band, so uncertainty is visible instead of
  hidden behind a single fake-precise line (see [Forecast horizons](#forecast-horizons--the-honest-version)).
- **Installable PWA** — offline caching of the last-loaded forecast and map
  tiles; add to home screen on iOS/Android/desktop.
- **Saved locations + search** — stored locally on your device only.

## Forecast horizons — the honest version

Weather prediction has a hard physical ceiling. Rather than pretend otherwise,
Nimbus presents three tiers matched to how much confidence the science supports:

| Horizon      | Source                        | Confidence                          |
| ------------ | ----------------------------- | ----------------------------------- |
| 0–2 hours    | RainViewer radar nowcast      | High — the radar killer feature     |
| 0–16 days    | Open-Meteo (GFS/ECMWF)        | Good, fading after ~10 days         |
| 15–35 days   | Open-Meteo **ensemble**       | Low — shown as a probability band   |

The Outlook tab renders the ensemble member spread and dims days further out to
signal falling confidence. Treat it as a trend, not a promise.

## Data sources (all free, no key, no ads)

- **[RainViewer](https://www.rainviewer.com/api.html)** — radar tiles (past +
  nowcast).
- **[Open-Meteo](https://open-meteo.com/)** — forecast, geocoding, and ensemble
  APIs.
- **[CARTO](https://carto.com/basemaps/)** / OpenStreetMap — dark base map tiles.

No data is sent to any first-party server — there is no backend. Saved places
live in `localStorage` on your device.

## Tech stack

- **Vanilla JS + [Vite](https://vitejs.dev/)** — small, fast, dependency-light.
- **[MapLibre GL](https://maplibre.org/)** — smooth animated radar tile layers.
- **[vite-plugin-pwa](https://vite-pwa-org.netlify.app/)** (Workbox) — service
  worker, manifest, offline caching.

## Develop

```bash
npm install
npm run dev      # dev server with HMR
npm run build    # production build → dist/
npm run preview  # preview the production build locally
```

Then open the printed URL. Use HTTPS (or `localhost`) so geolocation and the
service worker are available.

## Deploy

The build is fully static — deploy `dist/` to any static host (Netlify, Vercel,
GitHub Pages, Cloudflare Pages, etc.). Because `base` is `./`, it works from a
subpath too. Serve over HTTPS so it's installable as a PWA.

## Project layout

```
index.html          App shell / markup
src/main.js         Orchestration, UI rendering, events
src/radar.js        MapLibre map + animated RainViewer radar layers
src/forecast.js     Open-Meteo forecast, geocoding, ensemble outlook
src/wmo.js          WMO weather-code → label/glyph mapping
src/store.js        Saved locations (localStorage)
src/style.css       Styling
public/icons/       PWA icons
vite.config.js      Vite + PWA (manifest, Workbox runtime caching)
```

## Notes & roadmap ideas

- Units are currently °F / mph / inch (US). A units toggle is a natural next
  step (Open-Meteo takes unit params directly).
- Reverse-geocoding for a friendlier "My location" label.
- Severe-weather alerts (e.g. NWS `api.weather.gov/alerts` for US locations).
- Satellite / cloud layer toggle (RainViewer also serves infrared satellite).
