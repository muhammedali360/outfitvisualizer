export interface Weather {
  tempC: number
  precipProb: number
  desc: string
  emoji: string
}

const WMO: Array<[number, string, string]> = [
  [0, 'Clear', '☀️'],
  [1, 'Mostly clear', '🌤️'],
  [2, 'Partly cloudy', '⛅'],
  [3, 'Overcast', '☁️'],
  [45, 'Foggy', '🌫️'],
  [48, 'Foggy', '🌫️'],
  [51, 'Drizzle', '🌦️'],
  [53, 'Drizzle', '🌦️'],
  [55, 'Drizzle', '🌦️'],
  [61, 'Rain', '🌧️'],
  [63, 'Rain', '🌧️'],
  [65, 'Heavy rain', '🌧️'],
  [66, 'Freezing rain', '🌧️'],
  [67, 'Freezing rain', '🌧️'],
  [71, 'Snow', '🌨️'],
  [73, 'Snow', '🌨️'],
  [75, 'Heavy snow', '❄️'],
  [77, 'Snow', '🌨️'],
  [80, 'Showers', '🌦️'],
  [81, 'Showers', '🌧️'],
  [82, 'Heavy showers', '🌧️'],
  [85, 'Snow showers', '🌨️'],
  [86, 'Snow showers', '🌨️'],
  [95, 'Thunderstorm', '⛈️'],
  [96, 'Thunderstorm', '⛈️'],
  [99, 'Thunderstorm', '⛈️'],
]

function describe(code: number): [string, string] {
  const hit = WMO.find(([c]) => c === code)
  return hit ? [hit[1], hit[2]] : ['Mixed weather', '🌥️']
}

/**
 * Today's forecast for the user's location via Open-Meteo (free, no API key).
 * Returns null if geolocation is denied or the network fails.
 */
export async function fetchWeather(): Promise<Weather | null> {
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 8000,
        maximumAge: 600000,
      }),
    )
    const { latitude, longitude } = pos.coords
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&daily=temperature_2m_max,precipitation_probability_max,weather_code&timezone=auto&forecast_days=1`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const tempC = Math.round(data.daily.temperature_2m_max[0])
    const precipProb = Math.round(data.daily.precipitation_probability_max?.[0] ?? 0)
    const [desc, emoji] = describe(data.daily.weather_code[0])
    return { tempC, precipProb, desc, emoji }
  } catch {
    return null
  }
}
