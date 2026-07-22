// "What to wear" — turns current conditions into a plain-language clothing
// suggestion. Driven mainly by the feels-like (apparent) temperature in °F,
// with add-ons for rain, snow, wind, and sun.

const BANDS = [
  { max: 20, key: 'frigid', emoji: '🥶', headline: 'Frigid — bundle up hard',
    base: ['Heavy winter coat', 'Hat, gloves & scarf', 'Thermal base layers', 'Insulated boots'] },
  { max: 32, key: 'very-cold', emoji: '🧣', headline: 'Very cold',
    base: ['Warm winter coat', 'Hat & gloves', 'Sweater or fleece layer'] },
  { max: 42, key: 'cold', emoji: '🧥', headline: 'Cold',
    base: ['Warm coat', 'Long sleeves', 'Consider a hat'] },
  { max: 52, key: 'chilly', emoji: '🧥', headline: 'Chilly',
    base: ['Jacket or heavy sweater', 'Long pants'] },
  { max: 62, key: 'cool', emoji: '👕', headline: 'Cool',
    base: ['Light jacket or sweater', 'A layer you can remove'] },
  { max: 72, key: 'mild', emoji: '👕', headline: 'Mild & comfortable',
    base: ['Long sleeves or a light top', 'Light layer for later'] },
  { max: 82, key: 'warm', emoji: '😎', headline: 'Warm',
    base: ['T-shirt', 'Shorts or light pants'] },
  { max: 999, key: 'hot', emoji: '🥵', headline: 'Hot — keep it light',
    base: ['Light, breathable clothing', 'Shorts & t-shirt', 'Stay hydrated'] },
]

// WMO codes that mean rain/drizzle/showers/thunder.
const RAINY = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])
// WMO codes that mean snow.
const SNOWY = new Set([71, 73, 75, 77, 85, 86])

/**
 * @param {object} o
 * @param {number} o.feels  apparent temperature (°F)
 * @param {number} o.code   WMO weather code
 * @param {number} o.wind   wind speed (mph)
 * @param {number|null} o.uv today's max UV index
 * @param {number|null} o.pop precipitation probability (%) for the next few hours
 * @param {boolean} o.isDay
 */
function bandFor(feels) {
  return BANDS.find((b) => feels < b.max) || BANDS[BANDS.length - 1]
}

export function clothingAdvice({ feels, code, wind, uv, pop, isDay }) {
  const band = bandFor(feels)
  const tips = [...band.base]
  const addons = []

  const rainy = RAINY.has(code)
  const snowy = SNOWY.has(code)
  const likelyWet = pop != null && pop >= 40

  if (snowy) addons.push({ icon: '❄️', text: 'Snow — waterproof boots & gloves' })
  else if (rainy) addons.push({ icon: '☔', text: 'Rain — umbrella or waterproof jacket' })
  else if (likelyWet) addons.push({ icon: '🌂', text: `Rain likely (${pop}%) — bring an umbrella` })

  if (wind >= 20) addons.push({ icon: '💨', text: 'Windy — a windproof layer helps' })

  if (isDay && uv != null && uv >= 6)
    addons.push({ icon: '🧴', text: `High UV (${Math.round(uv)}) — sunscreen & sunglasses` })
  else if (band.key === 'hot' || band.key === 'warm')
    addons.push({ icon: '😎', text: 'Sunglasses for the glare' })

  return { emoji: band.emoji, headline: band.headline, key: band.key, tips, addons }
}

// Per-day advice for the 16-day forecast, for packing. Driven by the day's
// high (what you dress for during the day), with a note when the low is much
// cooler so you pack a layer for mornings/evenings.
export function clothingForDay({ tMax, tMin, code, wind, uv, pop }) {
  const advice = clothingAdvice({
    feels: tMax,
    code,
    wind,
    uv,
    pop,
    isDay: true,
  })
  if (tMin != null && tMax != null && tMax - tMin >= 18 && tMin < 55) {
    advice.addons = [
      ...advice.addons,
      { icon: '🌗', text: `Cooler around ${tMin}° early & late — pack a layer` },
    ]
  }
  return advice
}

// Aggregate a packing list across a range of days: overall temperature span,
// a clothing bracket from the coldest to the warmest, and the union of gear
// (rain/snow/wind/sun) you'd want along the way.
// Collapse a per-day addon (which carries day-specific numbers) to a generic
// packing-list item, keyed by icon so the summary lists each kind once.
const GEAR_BY_ICON = {
  '☔': { icon: '☔', text: 'Umbrella / rain jacket' },
  '🌂': { icon: '☔', text: 'Umbrella / rain jacket' },
  '❄️': { icon: '❄️', text: 'Snow boots & gloves' },
  '💨': { icon: '💨', text: 'Windproof layer' },
  '🧴': { icon: '🧴', text: 'Sunscreen & sunglasses' },
  '😎': { icon: '😎', text: 'Sunglasses' },
  '🌗': { icon: '🌗', text: 'Layer for cool mornings' },
}

export function packingList(days) {
  let lo = Infinity
  let hi = -Infinity
  const gear = new Map()
  for (const d of days) {
    if (d.tMin != null) lo = Math.min(lo, d.tMin)
    if (d.tMax != null) hi = Math.max(hi, d.tMax)
    clothingForDay(d).addons.forEach((x) => {
      const g = GEAR_BY_ICON[x.icon]
      if (g) gear.set(g.icon, g)
    })
  }
  if (!isFinite(lo) || !isFinite(hi)) return null

  const coldBand = bandFor(lo)
  const warmBand = bandFor(hi)
  const clothes = []
  if (coldBand.key !== warmBand.key) {
    // Range spans bands: pack for both the cold end and the warm end.
    clothes.push({ icon: coldBand.emoji, text: coldBand.base[0] })
    clothes.push({ icon: warmBand.emoji, text: warmBand.base[0] })
  } else {
    clothes.push({ icon: warmBand.emoji, text: warmBand.base[0] })
    if (warmBand.base[1]) clothes.push({ icon: '', text: warmBand.base[1] })
  }
  return { lo, hi, clothes, gear: [...gear.values()] }
}
