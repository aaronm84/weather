// Saved locations + last-viewed, persisted to localStorage. No accounts, no
// server, no tracking — everything stays on the device.

const KEY = 'nimbus.state.v1'

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* storage full / disabled — ignore */
  }
}

export function getSaved() {
  return read().saved || []
}

export function saveLocation(loc) {
  const state = read()
  const saved = state.saved || []
  if (!saved.some((s) => s.lat === loc.lat && s.lon === loc.lon)) {
    saved.unshift({ name: loc.name, admin: loc.admin, lat: loc.lat, lon: loc.lon })
    state.saved = saved.slice(0, 12)
    write(state)
  }
  return state.saved
}

export function removeLocation(lat, lon) {
  const state = read()
  state.saved = (state.saved || []).filter((s) => s.lat !== lat || s.lon !== lon)
  write(state)
  return state.saved
}

export function isSaved(lat, lon) {
  return getSaved().some((s) => s.lat === lat && s.lon === lon)
}

export function getLast() {
  return read().last || null
}

export function setLast(loc) {
  const state = read()
  state.last = { name: loc.name, admin: loc.admin, lat: loc.lat, lon: loc.lon }
  write(state)
}
