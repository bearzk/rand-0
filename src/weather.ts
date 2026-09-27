import { renderWeather } from "./render";
import { sendFrame, listenButtons } from "./device";

const CACHE_TTL = 6 * 3600 * 1000;

interface WeatherData {
  city: string; temp: number; feels: number; desc: string; code: number;
  humid: number; wind: number; winddir: string; precip: number;
  sunrise: string; sunset: string; date: string;
}

const cache = new Map<string, { data: WeatherData; fetchedAt: number }>();

async function fetchWeather(city: string): Promise<WeatherData> {
  const entry = cache.get(city);
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL) return entry.data;

  console.log(`Fetching weather for ${city}...`);
  const r = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
  if (!r.ok) throw new Error(`wttr.in ${r.status}`);
  const d = await r.json() as any;
  const c = d.current_condition[0];
  const w = d.weather[0];
  const data: WeatherData = {
    city: city.charAt(0).toUpperCase() + city.slice(1),
    temp: parseInt(c.temp_C), feels: parseInt(c.FeelsLikeC),
    desc: c.weatherDesc[0].value.trim(), code: parseInt(c.weatherCode),
    humid: parseInt(c.humidity), wind: parseInt(c.windspeedKmph),
    winddir: c.winddir16Point, precip: parseFloat(c.precipMM),
    sunrise: w.astronomy[0].sunrise, sunset: w.astronomy[0].sunset,
    date: w.date,
  };
  cache.set(city, { data, fetchedAt: Date.now() });
  return data;
}

export class WeatherSession {
  private stop: (() => void) | null = null;
  private cities: string[];
  private cityIdx = 0;
  private ip: string;

  constructor(cities: string[], ip: string) {
    this.cities = cities;
    this.ip = ip;
  }

  async start() {
    await this.push();
    this.stop = listenButtons(this.ip, async (key) => {
      if (key === "down") {
        this.cityIdx = (this.cityIdx + 1) % this.cities.length;
        await this.push().catch(console.error);
      }
    });
  }

  private async push() {
    const city = this.cities[this.cityIdx] ?? this.cities[0] ?? "munich";
    const w = await fetchWeather(city);
    const entry = cache.get(city);
    const minsAgo = entry ? Math.floor((Date.now() - entry.fetchedAt) / 60000) : 0;
    const frame = renderWeather({ ...w, cachedMinsAgo: minsAgo });
    await sendFrame(this.ip, frame);
    console.log(`Weather: sent ${city}`);
  }

  close() {
    this.stop?.();
    this.stop = null;
  }
}
