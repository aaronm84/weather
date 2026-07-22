// Radar layer — animated RainViewer frames (past + nowcast) on a MapLibre map.
// RainViewer: free, no key. https://www.rainviewer.com/api.html

import maplibregl from 'maplibre-gl'

const INDEX_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const COLOR_SCHEME = 4 // "The Weather Channel"-style palette
const TILE_SIZE = 512
const SMOOTH = 1
const SNOW = 1

// Dark, label-light base style built from CARTO's free raster tiles so we need
// no map API key. Radar reads best over a muted basemap.
const BASE_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution:
        '© OpenStreetMap contributors © CARTO · Radar © RainViewer',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0b1220' } },
    { id: 'carto', type: 'raster', source: 'carto', paint: { 'raster-opacity': 0.9 } },
  ],
}

export class RadarMap {
  constructor(container, { onFrameChange } = {}) {
    this.map = new maplibregl.Map({
      container,
      style: BASE_STYLE,
      center: [-98.5, 39.5],
      zoom: 4,
      attributionControl: { compact: true },
      dragRotate: false,
    })
    this.map.touchZoomRotate.disableRotation()
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    this.frames = [] // { time, path, isNowcast }
    this.index = 0
    this.playing = false
    this.timer = null
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

  play() {
    if (this.playing || this.frames.length < 2) return
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
