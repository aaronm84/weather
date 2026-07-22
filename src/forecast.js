// Data layer — Open-Meteo (forecast, geocoding, ensemble outlook).
// All free, no API key, no ads, no tracking.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const REVERSE_URL = 'https://geocoding-api.open-meteo.com/v1/search' // fallback label only
const ENSEMBLE_URL = 'https://ensemble-api.open-meteo.com/v1/ensemble'

async function getJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

// ---- Geocoding --------------------------------------------------------------

export async function geocode(query) {
  if (!query || query.trim().length < 2) return []
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(
    query.trim(),
  )}&count=6&language=en&format=json`
  const data = await getJSON(url)
  return (data.results || []).map((r) => ({
    id: r.id,
    name: r.name,
    admin: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
    tz: r.timezone,
  }))
}

// ---- Standard forecast (current + hourly + 16-day daily) --------------------

export async function getForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
    hourly:
      'temperature_2m,precipitation_probability,precipitation,weather_code,is_day',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,sunrise,sunset,uv_index_max',
    timezone: 'auto',
    forecast_days: '16',
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
  })
  const data = await getJSON(`${FORECAST_URL}?${params}`)
  return normalizeForecast(data)
}

function normalizeForecast(d) {
  const c = d.current || {}
  const h = d.hourly || {}
  const day = d.daily || {}

  // Hourly: only keep from "now" forward, next 24 entries.
  const nowIso = c.time
  let startIdx = 0
  if (nowIso && h.time) {
    const found = h.time.findIndex((t) => t >= nowIso)
    startIdx = found < 0 ? 0 : found
  }
  const hourly = []
  for (let i = startIdx; i < startIdx + 24 && i < (h.time?.length || 0); i++) {
    hourly.push({
      time: h.time[i],
      temp: Math.round(h.temperature_2m[i]),
      pop: h.precipitation_probability?.[i] ?? null,
      precip: h.precipitation?.[i] ?? 0,
      code: h.weather_code?.[i] ?? 0,
      isDay: (h.is_day?.[i] ?? 1) === 1,
    })
  }

  const daily = (day.time || []).map((t, i) => ({
    date: t,
    code: day.weather_code[i],
    tMax: Math.round(day.temperature_2m_max[i]),
    tMin: Math.round(day.temperature_2m_min[i]),
    pop: day.precipitation_probability_max?.[i] ?? null,
    precip: day.precipitation_sum?.[i] ?? 0,
    wind: Math.round(day.wind_speed_10m_max?.[i] ?? 0),
    sunrise: day.sunrise?.[i],
    sunset: day.sunset?.[i],
    uv: day.uv_index_max?.[i] ?? null,
  }))

  return {
    tz: d.timezone,
    units: {
      temp: d.current_units?.temperature_2m || '°F',
      wind: d.current_units?.wind_speed_10m || 'mph',
    },
    current: {
      temp: Math.round(c.temperature_2m),
      feels: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      code: c.weather_code,
      wind: Math.round(c.wind_speed_10m),
      windDir: c.wind_direction_10m,
      isDay: c.is_day === 1,
      precip: c.precipitation,
    },
    hourly,
    daily,
  }
}

// ---- Long-range outlook (ensemble spread, ~35 days) -------------------------
// Honest low-confidence tier: we render the member spread as a band so the
// growing uncertainty is visible rather than hidden behind a single line.

export async function getOutlook(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    models: 'gfs_seamless',
    timezone: 'auto',
    forecast_days: '35',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
  })
  const d = await getJSON(`${ENSEMBLE_URL}?${params}`)
  return normalizeOutlook(d)
}

function collectMembers(daily, prefix) {
  // Ensemble responses expose per-member keys like "temperature_2m_max_member01".
  const keys = Object.keys(daily).filter((k) => k.startsWith(prefix))
  return keys.map((k) => daily[k]).filter(Array.isArray)
}

function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return null
  const pos = (sortedAsc.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const next = sortedAsc[base + 1]
  return next !== undefined
    ? sortedAsc[base] + rest * (next - sortedAsc[base])
    : sortedAsc[base]
}

function normalizeOutlook(d) {
  const day = d.daily || {}
  const dates = day.time || []
  const maxMembers = collectMembers(day, 'temperature_2m_max')
  const minMembers = collectMembers(day, 'temperature_2m_min')
  const precipMembers = collectMembers(day, 'precipitation_sum')

  const days = dates.map((date, i) => {
    const maxVals = maxMembers.map((m) => m[i]).filter((v) => v != null)
    const minVals = minMembers.map((m) => m[i]).filter((v) => v != null)
    const precipVals = precipMembers.map((m) => m[i]).filter((v) => v != null)
    const maxSorted = [...maxVals].sort((a, b) => a - b)
    const minSorted = [...minVals].sort((a, b) => a - b)

    // Chance of a wet day = share of ensemble members with >0.04in precip.
    const wetShare = precipVals.length
      ? precipVals.filter((v) => v >= 0.04).length / precipVals.length
      : null

    return {
      date,
      tMaxLow: round(quantile(maxSorted, 0.1)),
      tMaxMean: round(mean(maxVals)),
      tMaxHigh: round(quantile(maxSorted, 0.9)),
      tMinMean: round(mean(minVals)),
      tMinLow: round(quantile(minSorted, 0.1)),
      wetChance: wetShare == null ? null : Math.round(wetShare * 100),
      members: maxVals.length,
    }
  })

  return { tz: d.timezone, days, memberCount: maxMembers.length }
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
const round = (v) => (v == null ? null : Math.round(v))
