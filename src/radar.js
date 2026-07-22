// Radar layer on a MapLibre map, with two animated providers:
//   • "forecast"  — RainViewer: global, past frames + a predicted future
//                    "nowcast" (forecasted radar movement). Free, no key.
//   • "detailed"  — NWS NEXRAD base reflectivity (N0Q) via the Iowa
//                    Environmental Mesonet: US, high-resolution, observed only.
// Both animate through the shared timeline/play controls.

import maplibregl from 'maplibre-gl'

// ---- RainViewer ("forecast") ------------------------------------------------
const INDEX_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const COLOR_SCHEME = 4 // "The Weather Channel"-style palette
const RV_TILE_SIZE = 512
const SMOOTH = 1
const SNOW = 1
// RainViewer's free API serves 512px tiles only to z7; declaring it makes
// MapLibre overzoom (scale) rather than request unsupported placeholder tiles.
const RV_MAX_ZOOM = 7

// ---- NWS / IEM ("detailed") -------------------------------------------------
// IEM exposes relative "time-lagged" layers (…-m05m … -m50m) plus the current
// composite, so we can build an observed ~50-minute loop with no clock math.
const HD_BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0'
const HD_TILE_SIZE = 256
const HD_MAX_ZOOM = 12
const HD_OFFSETS = [50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0] // minutes ago

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
        'raster-saturation': -0.55,
        'raster-brightness-max': 0.5,
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
      maxZoom: 22,
      attributionControl: { compact: true },
      dragRotate: false,
    })
    this.map.touchZoomRotate.disableRotation()
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    this.frames = [] // { time, tiles, isFuture }
    this.index = 0
    this.playing = false
    this.timer = null
    this.mode = 'forecast'
    this.providerMaxZoom = RV_MAX_ZOOM
    this.providerTileSize = RV_TILE_SIZE
    this.host = 'https://tilecache.rainviewer.com'
    this.onFrameChange = onFrameChange || (() => {})
    this.marker = null
    this._loadPromise = new Promise((res) => this.map.on('load', res))
  }

  async ready() {
    return this._loadPromise
  }

  // ---- Providers ------------------------------------------------------------
  _rvUrl(path) {
    return `${this.host}${path}/${RV_TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/${SMOOTH}_${SNOW}.png`
  }

  async _loadRainviewer() {
    const res = await fetch(INDEX_URL)
    if (!res.ok) throw new Error('Radar index unavailable')
    const data = await res.json()
    this.host = data.host || this.host
    const past = (data.radar?.past || []).map((f) => ({
      time: f.time,
      tiles: this._rvUrl(f.path),
      isFuture: false,
    }))
    const future = (data.radar?.nowcast || []).map((f) => ({
      time: f.time,
      tiles: this._rvUrl(f.path),
      isFuture: true, // predicted radar movement
    }))
    this.frames = [...past, ...future]
    this.providerMaxZoom = RV_MAX_ZOOM
    this.providerTileSize = RV_TILE_SIZE
  }

  _hdUrl(offMin) {
    const layer =
      offMin === 0 ? 'nexrad-n0q-900913' : `nexrad-n0q-900913-m${String(offMin).padStart(2, '0')}m`
    return `${HD_BASE}/${layer}/{z}/{x}/{y}.png`
  }

  _loadHD() {
    const nowSec = Math.floor(Date.now() / 1000)
    this.frames = HD_OFFSETS.map((off) => ({
      time: nowSec - off * 60,
      tiles: this._hdUrl(off),
      isFuture: false,
    }))
    this.providerMaxZoom = HD_MAX_ZOOM
    this.providerTileSize = HD_TILE_SIZE
  }

  // ---- Layers ---------------------------------------------------------------
  _layerId(i) {
    return `radar-${i}`
  }

  _clearRadarLayers() {
    let i = 0
    while (this.map.getLayer(this._layerId(i)) || this.map.getSource(this._layerId(i))) {
      const id = this._layerId(i)
      if (this.map.getLayer(id)) this.map.removeLayer(id)
      if (this.map.getSource(id)) this.map.removeSource(id)
      i++
    }
  }

  _buildLayers() {
    this.frames.forEach((frame, i) => {
      const sid = this._layerId(i)
      this.map.addSource(sid, {
        type: 'raster',
        tiles: [frame.tiles],
        tileSize: this.providerTileSize,
        maxzoom: this.providerMaxZoom,
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

  // Index of the most recent *observed* (non-future) frame.
  _nowIndex() {
    let idx = 0
    this.frames.forEach((f, i) => {
      if (!f.isFuture) idx = i
    })
    return idx
  }

  showFrame(i) {
    if (!this.frames.length) return
    this.index = (i + this.frames.length) % this.frames.length
    this.frames.forEach((_, j) => {
      const sid = this._layerId(j)
      if (this.map.getLayer(sid)) {
        this.map.setPaintProperty(sid, 'raster-opacity', j === this.index ? 0.85 : 0)
      }
    })
    this.onFrameChange(this.index, this.frames[this.index])
  }

  next() {
    this.showFrame(this.index + 1)
  }

  /** Load a provider and rebuild the animation. Returns { mode, frameCount }. */
  async setMode(mode) {
    const m = mode === 'detailed' ? 'detailed' : 'forecast'
    this.pause()
    await this.ready()
    this._clearRadarLayers()
    this.mode = m
    try {
      if (m === 'forecast') await this._loadRainviewer()
      else this._loadHD()
    } catch (e) {
      this.frames = []
    }
    this._buildLayers()
    this.index = this._nowIndex()
    this.showFrame(this.index)
    return { mode: m, frameCount: this.frames.length }
  }

  play() {
    if (this.playing || this.frames.length < 2) return
    this.playing = true
    let hold = 0
    this.timer = setInterval(() => {
      // Linger a beat on the final (most-future) frame before looping.
      if (this.index === this.frames.length - 1 && hold < 2) {
        hold++
        return
      }
      hold = 0
      this.next()
    }, 450)
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
