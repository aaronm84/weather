// Radar layer on a MapLibre map, with two animated providers — both from the
// Iowa Environmental Mesonet (free, no key), both US:
//   • "live"     — NWS NEXRAD base reflectivity (N0Q): observed, high-res,
//                  a ~50-minute past loop.
//   • "forecast" — NOAA HRRR model simulated reflectivity (REFD): a genuine
//                  forecast of radar out to +3h, showing predicted movement.
// Both animate through the shared timeline/play controls.

import maplibregl from 'maplibre-gl'

const IEM_BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0'

// NWS NEXRAD observed ("live"). IEM exposes relative time-lagged layers.
const NEXRAD_TILE_SIZE = 256
const NEXRAD_MAX_ZOOM = 12
const NEXRAD_OFFSETS = [50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0] // minutes ago

// HRRR model forecast ("forecast"). REFD-F{minutes}-{init}; forecast token is
// minutes (4-digit), every 15 min to +18h. Init "0" = latest, but we pin an
// explicitly-available run so frame valid-times are accurate.
const HRRR_TILE_SIZE = 256
const HRRR_MAX_ZOOM = 10
const HRRR_PAST_MIN = 30 // minutes of pre-now context
const HRRR_FUTURE_MIN = 180 // minutes ahead
const HRRR_STEP = 15

function utcStamp(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
}

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
        '© OpenStreetMap · Radar: NWS NEXRAD & NOAA HRRR via Iowa Environmental Mesonet',
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
    this.mode = 'live'
    this.providerMaxZoom = NEXRAD_MAX_ZOOM
    this.providerTileSize = NEXRAD_TILE_SIZE
    this.onFrameChange = onFrameChange || (() => {})
    this.marker = null
    this._loadPromise = new Promise((res) => this.map.on('load', res))
  }

  async ready() {
    return this._loadPromise
  }

  // ---- Providers ------------------------------------------------------------
  _loadNexrad() {
    const nowSec = Math.floor(Date.now() / 1000)
    this.frames = NEXRAD_OFFSETS.map((off) => {
      const layer = off === 0 ? 'nexrad-n0q-900913' : `nexrad-n0q-900913-m${String(off).padStart(2, '0')}m`
      return {
        time: nowSec - off * 60,
        tiles: `${IEM_BASE}/${layer}/{z}/{x}/{y}.png`,
        isFuture: false,
      }
    })
    this.providerMaxZoom = NEXRAD_MAX_ZOOM
    this.providerTileSize = NEXRAD_TILE_SIZE
  }

  _loadHRRR() {
    const nowMs = Date.now()
    // Pin an explicitly-available run: top of the hour, 2h ago (UTC). IEM has
    // processed it, and knowing the init lets us label frames by valid time.
    const initMs = Math.floor(nowMs / 3600000) * 3600000 - 2 * 3600000
    const initToken = utcStamp(initMs)
    const baseLead = Math.floor((nowMs - initMs) / 60000 / HRRR_STEP) * HRRR_STEP
    const frames = []
    for (let m = baseLead - HRRR_PAST_MIN; m <= baseLead + HRRR_FUTURE_MIN; m += HRRR_STEP) {
      if (m < 0) continue
      const validMs = initMs + m * 60000
      frames.push({
        time: Math.floor(validMs / 1000),
        tiles: `${IEM_BASE}/hrrr::REFD-F${String(m).padStart(4, '0')}-${initToken}/{z}/{x}/{y}.png`,
        isFuture: validMs > nowMs,
      })
    }
    this.frames = frames
    this.providerMaxZoom = HRRR_MAX_ZOOM
    this.providerTileSize = HRRR_TILE_SIZE
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

  /** Load a provider and rebuild the animation. */
  async setMode(mode) {
    const m = mode === 'forecast' ? 'forecast' : 'live'
    this.pause()
    await this.ready()
    this._clearRadarLayers()
    this.mode = m
    try {
      if (m === 'forecast') this._loadHRRR()
      else this._loadNexrad()
    } catch (e) {
      this.frames = []
    }
    this._buildLayers()
    this.index = this._nowIndex()
    this.showFrame(this.index)
    const futureCount = this.frames.filter((f) => f.isFuture).length
    const last = this.frames[this.frames.length - 1]
    return {
      mode: m,
      frameCount: this.frames.length,
      nowIndex: this.index,
      futureCount,
      lastTime: last ? last.time : null,
    }
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
