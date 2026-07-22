import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import { RadarMap } from './radar.js'
import { geocode, getForecast, getOutlook } from './forecast.js'
import { wmoLabel, wmoGlyph } from './wmo.js'
import { getSaved, saveLocation, removeLocation, isSaved, getLast, setLast } from './store.js'

// ---- Element refs -----------------------------------------------------------
const $ = (id) => document.getElementById(id)
const el = {
  locateBtn: $('locateBtn'),
  savedBtn: $('savedBtn'),
  searchInput: $('searchInput'),
  searchResults: $('searchResults'),
  playBtn: $('playBtn'),
  playIcon: $('playIcon'),
  pauseIcon: $('pauseIcon'),
  timeline: $('timeline'),
  timeText: $('timeText'),
  nowcastBadge: $('nowcastBadge'),
  panel: $('panel'),
  panelHandle: $('panelHandle'),
  nowTemp: $('nowTemp'),
  nowPlace: $('nowPlace'),
  nowDesc: $('nowDesc'),
  nowStats: $('nowStats'),
  tierTabs: document.querySelectorAll('.tier-tab'),
  tierViews: document.querySelectorAll('.tier-view'),
  hourlyStrip: $('hourlyStrip'),
  dailyList: $('dailyList'),
  outlookIntro: $('outlookIntro'),
  outlookBody: $('outlookBody'),
  toast: $('toast'),
}

let radar
let currentLoc = null
let outlookLoaded = false

// ---- Boot -------------------------------------------------------------------
init()

async function init() {
  radar = new RadarMap('map', { onFrameChange: onRadarFrame })
  wireEvents()

  try {
    await radar.loadFrames()
  } catch (e) {
    toast('Radar data unavailable right now.')
  }
  el.timeline.max = String(Math.max(0, radar.frames.length - 1))
  el.timeline.value = String(radar.index)

  // Pick an initial location: last used → geolocation → US default.
  const last = getLast()
  if (last) {
    selectLocation(last, { fly: false })
  } else {
    el.nowPlace.textContent = 'Tap ◎ for your location'
  }
  requestGeolocation({ silent: !!last })
}

// ---- Location handling ------------------------------------------------------
function requestGeolocation({ silent } = {}) {
  if (!('geolocation' in navigator)) {
    if (!silent) toast('Geolocation not supported.')
    return
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const loc = {
        name: 'My location',
        admin: '',
        lat: +pos.coords.latitude.toFixed(4),
        lon: +pos.coords.longitude.toFixed(4),
      }
      selectLocation(loc)
    },
    (err) => {
      if (!silent) toast('Location permission denied.')
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
  )
}

async function selectLocation(loc, { fly = true } = {}) {
  currentLoc = loc
  setLast(loc)
  outlookLoaded = false
  radar.setLocation(loc.lat, loc.lon, { zoom: loc.name === 'My location' ? 8 : 8, fly })
  el.nowPlace.textContent = loc.name + (loc.admin ? ` · ${loc.admin}` : '')
  refreshSavedBtn()

  el.nowTemp.textContent = '—'
  el.nowDesc.textContent = 'Loading…'
  try {
    const fc = await getForecast(loc.lat, loc.lon)
    renderCurrent(fc, loc)
    renderHourly(fc)
    renderDaily(fc)
    currentLoc.units = fc.units
  } catch (e) {
    el.nowDesc.textContent = 'Forecast unavailable'
    toast('Could not load forecast.')
  }
  // Refresh whichever tier is active if it's the outlook.
  if (document.querySelector('.tier-tab.active')?.dataset.tier === 'outlook') {
    loadOutlook()
  }
}

// ---- Rendering: current + tiers --------------------------------------------
function renderCurrent(fc, loc) {
  const c = fc.current
  el.nowTemp.innerHTML = `${c.temp}<span class="deg">°</span>`
  el.nowDesc.textContent = `${wmoGlyph(c.code)} ${wmoLabel(c.code)}`
  el.nowStats.innerHTML = [
    stat('Feels', `${c.feels}°`),
    stat('Humidity', `${c.humidity}%`),
    stat('Wind', `${c.wind} ${fc.units.wind}`),
    stat('Precip', `${c.precip}"`),
  ].join('')
}

function stat(label, val) {
  return `<div class="stat"><span class="k">${label}</span><span class="v">${val}</span></div>`
}

function renderHourly(fc) {
  el.hourlyStrip.innerHTML = fc.hourly
    .map((h, i) => {
      const t = new Date(h.time)
      const hr = i === 0 ? 'Now' : t.toLocaleTimeString([], { hour: 'numeric' })
      const pop = h.pop != null && h.pop >= 5 ? `<span class="pop">${h.pop}%</span>` : '<span class="pop dim">·</span>'
      return `<div class="hour">
        <span class="h-time">${hr}</span>
        <span class="h-ico">${wmoGlyph(h.code)}</span>
        <span class="h-temp">${h.temp}°</span>
        ${pop}
      </div>`
    })
    .join('')
}

function renderDaily(fc) {
  const range = tempRange(fc.daily)
  el.dailyList.innerHTML = fc.daily
    .map((d, i) => {
      const date = new Date(d.date + 'T00:00:00')
      const name = i === 0 ? 'Today' : date.toLocaleDateString([], { weekday: 'short' })
      const md = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      const pop =
        d.pop != null && d.pop >= 5
          ? `<span class="d-pop">💧${d.pop}%</span>`
          : '<span class="d-pop dim"></span>'
      const bar = tempBar(d.tMin, d.tMax, range)
      return `<div class="day">
        <div class="d-name"><b>${name}</b><small>${md}</small></div>
        <div class="d-ico" title="${wmoLabel(d.code)}">${wmoGlyph(d.code)}</div>
        ${pop}
        <div class="d-range">
          <span class="t-lo">${d.tMin}°</span>
          ${bar}
          <span class="t-hi">${d.tMax}°</span>
        </div>
      </div>`
    })
    .join('')
}

function tempRange(daily) {
  const mins = daily.map((d) => d.tMin)
  const maxs = daily.map((d) => d.tMax)
  return { lo: Math.min(...mins), hi: Math.max(...maxs) }
}

function tempBar(tMin, tMax, range) {
  const span = Math.max(1, range.hi - range.lo)
  const left = ((tMin - range.lo) / span) * 100
  const width = ((tMax - tMin) / span) * 100
  return `<span class="bar"><span class="fill" style="left:${left}%;width:${Math.max(
    6,
    width,
  )}%"></span></span>`
}

// ---- Outlook tier (ensemble, honest low-confidence) -------------------------
async function loadOutlook() {
  if (!currentLoc) return
  if (outlookLoaded) return
  el.outlookIntro.textContent = 'Loading ensemble outlook…'
  el.outlookBody.innerHTML = ''
  try {
    const o = await getOutlook(currentLoc.lat, currentLoc.lon)
    renderOutlook(o)
    outlookLoaded = true
  } catch (e) {
    el.outlookIntro.textContent = ''
    el.outlookBody.innerHTML =
      '<p class="hint">Long-range outlook unavailable right now.</p>'
  }
}

function renderOutlook(o) {
  el.outlookIntro.innerHTML = `Beyond ~10 days, a single forecast is unreliable. This shows the spread of <b>${o.memberCount} ensemble members</b> — the band widens as confidence drops. Treat it as a trend, not a promise.`

  const days = o.days.slice(0, 35)
  const allHi = days.map((d) => d.tMaxHigh).filter((v) => v != null)
  const allLo = days.map((d) => d.tMinLow).filter((v) => v != null)
  const gLo = Math.min(...allLo)
  const gHi = Math.max(...allHi)
  const span = Math.max(1, gHi - gLo)
  const pct = (v) => ((v - gLo) / span) * 100

  el.outlookBody.innerHTML = days
    .map((d, i) => {
      const date = new Date(d.date + 'T00:00:00')
      const name = date.toLocaleDateString([], { weekday: 'short' })
      const md = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      const conf = i < 10 ? 'ok' : i < 21 ? 'mid' : 'low'
      const bandLeft = pct(d.tMinLow ?? d.tMaxLow)
      const bandRight = pct(d.tMaxHigh)
      const meanPos = pct(d.tMaxMean)
      const wet =
        d.wetChance == null
          ? ''
          : `<span class="o-wet ${d.wetChance >= 50 ? 'hi' : ''}">💧${d.wetChance}%</span>`
      return `<div class="o-day conf-${conf}">
        <div class="o-name"><b>${name}</b><small>${md}</small></div>
        <div class="o-band">
          <span class="o-track"></span>
          <span class="o-fill" style="left:${bandLeft}%;width:${Math.max(
            4,
            bandRight - bandLeft,
          )}%"></span>
          <span class="o-mean" style="left:${meanPos}%"></span>
        </div>
        <div class="o-vals"><span>${d.tMaxLow ?? '–'}°</span><b>${d.tMaxMean ?? '–'}°</b><span>${d.tMaxHigh ?? '–'}°</span></div>
        ${wet}
      </div>`
    })
    .join('')
}

// ---- Radar frame → timeline label ------------------------------------------
function onRadarFrame(index, frame) {
  el.timeline.value = String(index)
  if (!frame) return
  const t = new Date(frame.time * 1000)
  const label = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  el.timeText.textContent = frame.isNowcast ? `+ ${label}` : label
  el.nowcastBadge.hidden = !frame.isNowcast
}

// ---- Events -----------------------------------------------------------------
function wireEvents() {
  el.playBtn.addEventListener('click', () => {
    const playing = radar.toggle()
    el.playIcon.hidden = playing
    el.pauseIcon.hidden = !playing
  })

  el.timeline.addEventListener('input', (e) => {
    radar.pause()
    el.playIcon.hidden = false
    el.pauseIcon.hidden = true
    radar.showFrame(+e.target.value)
  })

  el.locateBtn.addEventListener('click', () => requestGeolocation({ silent: false }))

  // Search (debounced geocoding)
  let searchTimer
  el.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer)
    const q = e.target.value
    if (q.trim().length < 2) return hideResults()
    searchTimer = setTimeout(() => runSearch(q), 280)
  })
  el.searchInput.addEventListener('focus', () => {
    if (!el.searchInput.value) showSaved()
  })
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#searchWrap') && !e.target.closest('#savedBtn')) hideResults()
  })
  el.savedBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (currentLoc) toggleSaveCurrent()
    showSaved()
  })

  // Tier tabs
  el.tierTabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTier(tab.dataset.tier))
  })

  // Panel drag/expand
  el.panelHandle.addEventListener('click', () => togglePanel())
  el.panelHandle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      togglePanel()
    }
  })
}

function switchTier(tier) {
  el.tierTabs.forEach((t) => t.classList.toggle('active', t.dataset.tier === tier))
  el.tierViews.forEach((v) => (v.hidden = v.dataset.tier !== tier))
  if (tier === 'outlook') loadOutlook()
  el.panel.classList.add('open')
}

function togglePanel() {
  el.panel.classList.toggle('open')
}

// ---- Search results / saved -------------------------------------------------
async function runSearch(q) {
  try {
    const results = await geocode(q)
    if (!results.length) return renderResults([{ empty: true }])
    renderResults(results)
  } catch {
    hideResults()
  }
}

function renderResults(items) {
  el.searchResults.innerHTML = items
    .map((r) => {
      if (r.empty) return '<li class="empty">No matches</li>'
      return `<li role="option" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${escapeAttr(
        r.name,
      )}" data-admin="${escapeAttr(r.admin || '')}">
        <span class="r-name">${escapeHtml(r.name)}</span>
        <span class="r-admin">${escapeHtml(r.admin || '')}</span>
      </li>`
    })
    .join('')
  el.searchResults.hidden = false
  el.searchResults.querySelectorAll('li[data-lat]').forEach((li) => {
    li.addEventListener('click', () => {
      selectLocation({
        name: li.dataset.name,
        admin: li.dataset.admin,
        lat: +li.dataset.lat,
        lon: +li.dataset.lon,
      })
      el.searchInput.value = ''
      hideResults()
    })
  })
}

function showSaved() {
  const saved = getSaved()
  if (!saved.length) {
    el.searchResults.innerHTML = '<li class="empty">No saved places yet — search, then tap the ☆</li>'
    el.searchResults.hidden = false
    return
  }
  el.searchResults.innerHTML =
    '<li class="hdr">Saved</li>' +
    saved
      .map(
        (s) => `<li role="option" data-lat="${s.lat}" data-lon="${s.lon}" data-name="${escapeAttr(
          s.name,
        )}" data-admin="${escapeAttr(s.admin || '')}">
        <span class="r-name">⭐ ${escapeHtml(s.name)}</span>
        <span class="r-admin">${escapeHtml(s.admin || '')}</span>
        <button class="r-del" data-lat="${s.lat}" data-lon="${s.lon}" title="Remove">✕</button>
      </li>`,
      )
      .join('')
  el.searchResults.hidden = false
  el.searchResults.querySelectorAll('li[data-lat]').forEach((li) => {
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('r-del')) {
        removeLocation(+e.target.dataset.lat, +e.target.dataset.lon)
        showSaved()
        return
      }
      selectLocation({
        name: li.dataset.name,
        admin: li.dataset.admin,
        lat: +li.dataset.lat,
        lon: +li.dataset.lon,
      })
      hideResults()
    })
  })
}

function toggleSaveCurrent() {
  if (!currentLoc) return
  if (isSaved(currentLoc.lat, currentLoc.lon)) {
    removeLocation(currentLoc.lat, currentLoc.lon)
    toast('Removed from saved')
  } else {
    saveLocation(currentLoc)
    toast('Saved ⭐')
  }
  refreshSavedBtn()
}

function refreshSavedBtn() {
  const on = currentLoc && isSaved(currentLoc.lat, currentLoc.lon)
  el.savedBtn.classList.toggle('active', !!on)
}

function hideResults() {
  el.searchResults.hidden = true
}

// ---- Utils ------------------------------------------------------------------
let toastTimer
function toast(msg) {
  el.toast.textContent = msg
  el.toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (el.toast.hidden = true), 3000)
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function escapeAttr(s) {
  return escapeHtml(s)
}
