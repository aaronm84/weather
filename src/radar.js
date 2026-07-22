// Radar layer — animated RainViewer frames (past + nowcast) on a MapLibre map.
// RainViewer: free, no key. https://www.rainviewer.com/api.html

import maplibregl from 'maplibre-gl'

const INDEX_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const COLOR_SCHEME = 4 // "The Weather Channel"-style palette
const TILE_SIZE = 512
const SMOOTH = 1
const SNOW = 1
// RainViewer's free radar API serves 512px tiles only up to zoom 7 — beyond
// that the tile server returns a "Zoom Level Not Supported" placeholder image
// (confirmed: rainviewer-api-example README, "Max zoom: Level 7 (512px tiles)").
// Declaring it as the source maxzoom makes MapLibre overzoom (scale) the z7
// tile for closer views instead of requesting the placeholder tiles.
const RADAR_MAX_ZOOM = 7

// "HD" radar — NWS NEXRAD base-reflectivity composite (N0Q) served as tiles by
// the Iowa Environmental Mesonet. Free, no key, and high-resolution: sharp at
// city/street zoom where RainViewer's z7 imagery goes blocky. Current-frame
// only (no future nowcast), so it's offered as an alternate mode.
const HD_TILES =
  'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png'
const HD_LAYER = 'radar-hd'
const HD_MAX_ZOOM = 12
const HD_REFRESH_MS = 3 * 60 * 1000 // re-fetch the composite every 3 min

// Base map from OpenStreetMap raster tiles — the one provider with guaranteed
// complete global coverage to z19 (no rural gaps, so it never returns a
// "Zoom level not supported" placeholder like CARTO/Esri did). No API key.
// It's a light map, so we darken it with raster paint filters to fit the theme
// and let the colored radar read on top.
const BASE_STYLE = {
  version: 8,
  sources: {
    basemap: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '© OpenStreetMap · Radar: RainViewer & NWS/Iowa Environmental Mesonet',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0b1220' } },
    {
      id: 'basemap',
      type: 'raster',
      source: 'basemap',
      paint: {
        'raster-opacity': 1,
        'raster-saturation': -0.55, // mute OSM's colors
        'raster-brightness-max': 0.5, // dim it toward the dark theme
        'raster-contrast': 0.05,
      },
    },
  ],
}

export class RadarMap {
  constructor(container, { onFrameChange } = {}) {
    this.map = new maplibregl.Map({
      container,
      style: BASE_STYLE,
      center: [-98.5, 39.5],
      zoom: 4,
      maxZoom: 22, // zoom in as far as possible; z18 tiles are overzoomed (scaled) beyond native
      attributionControl: { compact: true },
      dragRotate: false,
    })
    this.map.touchZoomRotate.disableRotation()
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    this.frames = [] // { time, path, isNowcast }
    this.index = 0
    this.playing = false
    this.timer = null
    this.mode = 'forecast' // 'forecast' (RainViewer) | 'hd' (NWS/IEM)
    this.hdTimer = null
    this.host = 'https://tilecache.rainviewer.com'
    this.onFrameChange = onFrameChange || (() => {})
    this.marker = null
    this._loadPromise = new Promise((res) => this.map.on('load', res))
  }

  async ready() {
    return this._loadPromise
  }

  async loadFrames() {
    const res = await fetch(INDEX_URL)
    if (!res.ok) throw new Error('Radar index unavailable')
    const data = await res.json()
    this.host = data.host || this.host
    const past = (data.radar?.past || []).map((f) => ({ ...f, isNowcast: false }))
    const nowcast = (data.radar?.nowcast || []).map((f) => ({ ...f, isNowcast: true }))
    this.frames = [...past, ...nowcast]

    await this.ready()
    this._ensureLayers()
    // Start on the most recent *observed* frame (last past frame).
    this.index = Math.max(0, past.length - 1)
    this.showFrame(this.index)
    return this.frames
  }

  _tileUrl(path) {
    return `${this.host}${path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/${SMOOTH}_${SNOW}.png`
  }

  _layerId(i) {
    return `radar-${i}`
  }

  _ensureLayers() {
    // One source+layer per frame; we cross-fade opacity to animate. Preloading
    // as layers lets MapLibre cache tiles so playback is smooth.
    this.frames.forEach((frame, i) => {
      const sid = this._layerId(i)
      if (this.map.getSource(sid)) return
      this.map.addSource(sid, {
        type: 'raster',
        tiles: [this._tileUrl(frame.path)],
        tileSize: TILE_SIZE,
        maxzoom: RADAR_MAX_ZOOM, // overzoom beyond native to avoid placeholder tiles
      })
      this.map.addLayer({
        id: sid,
        type: 'raster',
        source: sid,
        paint: {
          'raster-opacity': 0,
          'raster-opacity-transition': { duration: 220 },
          'raster-fade-duration': 0,
        },
      })
    })
  }

  showFrame(i) {
    if (!this.frames.length) return
    this.index = (i + this.frames.length) % this.frames.length
    this.frames.forEach((_, j) => {
      const sid = this._layerId(j)
      if (!this.map.getLayer(sid)) return
      this.map.setPaintProperty(sid, 'raster-opacity', j === this.index ? 0.85 : 0)
    })
    this.onFrameChange(this.index, this.frames[this.index])
  }

  next() {
    this.showFrame(this.index + 1)
  }

  // ---- HD (NWS/IEM) radar mode ---------------------------------------------
  _ensureHDLayer() {
    if (this.map.getSource(HD_LAYER)) return
    this.map.addSource(HD_LAYER, {
      type: 'raster',
      tiles: [HD_TILES],
      tileSize: 256,
      maxzoom: HD_MAX_ZOOM, // overzoom beyond native for street-level views
    })
    this.map.addLayer({
      id: HD_LAYER,
      type: 'raster',
      source: HD_LAYER,
      paint: {
        'raster-opacity': 0,
        'raster-opacity-transition': { duration: 220 },
      },
    })
  }

  _refreshHD() {
    // Cache-bust the tile URL so MapLibre re-fetches the latest composite.
    const src = this.map.getSource(HD_LAYER)
    if (src && src.setTiles) src.setTiles([`${HD_TILES}?_=${Date.now()}`])
  }

  /** Switch between 'forecast' (RainViewer, animated) and 'hd' (NWS/IEM). */
  setMode(mode) {
    this.mode = mode === 'hd' ? 'hd' : 'forecast'
    const hd = this.mode === 'hd'
    this._ensureHDLayer()

    if (hd) {
      this.pause()
      // Hide all RainViewer frames, show the HD composite.
      this.frames.forEach((_, j) => {
        const sid = this._layerId(j)
        if (this.map.getLayer(sid)) this.map.setPaintProperty(sid, 'raster-opacity', 0)
      })
      this.map.setPaintProperty(HD_LAYER, 'raster-opacity', 0.85)
      this._refreshHD()
      if (!this.hdTimer) this.hdTimer = setInterval(() => this._refreshHD(), HD_REFRESH_MS)
    } else {
      // Hide HD, restore the current RainViewer frame.
      this.map.setPaintProperty(HD_LAYER, 'raster-opacity', 0)
      if (this.hdTimer) {
        clearInterval(this.hdTimer)
        this.hdTimer = null
      }
      this.showFrame(this.index)
    }
    return this.mode
  }

  play() {
    if (this.mode === 'hd' || this.playing || this.frames.length < 2) return
    this.playing = true
    this.timer = setInterval(() => {
      // Pause briefly on the final nowcast frame before looping.
      const atEnd = this.index === this.frames.length - 1
      this.next()
      if (atEnd) {
        /* looped */
      }
    }, 500)
  }

  pause() {
    this.playing = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  toggle() {
    this.playing ? this.pause() : this.play()
    return this.playing
  }

  setLocation(lat, lon, { zoom = 8, fly = true } = {}) {
    if (!this.marker) {
      const el = document.createElement('div')
      el.className = 'map-pin'
      this.marker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(this.map)
    } else {
      this.marker.setLngLat([lon, lat])
    }
    const opts = { center: [lon, lat], zoom }
    fly ? this.map.flyTo({ ...opts, speed: 1.4 }) : this.map.jumpTo(opts)
  }
}
