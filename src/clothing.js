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
export function clothingAdvice({ feels, code, wind, uv, pop, isDay }) {
  const band = BANDS.find((b) => feels < b.max) || BANDS[BANDS.length - 1]
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
