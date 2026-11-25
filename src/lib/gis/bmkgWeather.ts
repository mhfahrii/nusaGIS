export interface DailyWeatherForecast {
  date: string;
  dayName: string;
  weatherCode: number;
  conditionLabel: string;
  conditionEmoji: string;
  tempMaxC: number;
  tempMinC: number;
  precipitationMm: number;
  precipitationProbPct: number;
}

export interface LocationWeatherReport {
  lat: number;
  lng: number;
  temperatureC: number;
  apparentTempC: number;
  humidityPct: number;
  precipitationMm: number;
  windSpeedKmh: number;
  windDirectionDeg: number;
  weatherCode: number;
  conditionLabel: string;
  conditionEmoji: string;
  accentColor: string;
  agroAdvisory: string;
  updatedAt: string;
  dailyForecast: DailyWeatherForecast[];
}

export interface WmoWeatherMeta {
  label: string;
  emoji: string;
  color: string;
  advisory: string;
}

export function classifyWmoWeatherCode(code: number): WmoWeatherMeta {
  if (code === 0) {
    return {
      label: 'Cerah',
      emoji: '☀️',
      color: '#F59E0B',
      advisory: 'Cuaca cerah optimal untuk pemanenan, pemupukan, dan survei drone GIS.',
    };
  }
  if (code === 1 || code === 2) {
    return {
      label: 'Cerah Berawan',
      emoji: '⛅',
      color: '#38BDF8',
      advisory: 'Kondisi kondusif untuk aktivitas perawatan blok kebun dan pemupukan.',
    };
  }
  if (code === 3) {
    return {
      label: 'Berawan',
      emoji: '☁️',
      color: '#94A3B8',
      advisory: 'Tertutup awan, kelembapan stabil untuk pertumbuhan tanaman.',
    };
  }
  if (code === 45 || code === 48) {
    return {
      label: 'Berkabut',
      emoji: '🌫️',
      color: '#CBD5E1',
      advisory: 'Jarak pandang terbatas dan kelembapan tinggi; waspadai jamur daun.',
    };
  }
  if (code >= 51 && code <= 57) {
    return {
      label: 'Gerimis / Hujan Rintik',
      emoji: '🌦️',
      color: '#00D2FF',
      advisory: 'Hujan rintik; tunda penyemprotan pestisida/herbisida daun agar tidak tercuci.',
    };
  }
  if (code >= 61 && code <= 67) {
    return {
      label: 'Hujan Sedang',
      emoji: '🌧️',
      color: '#0EA5E9',
      advisory: 'Curah hujan aktif; pantau drainase parit afdeling dan tunda aplikasi pupuk tabur.',
    };
  }
  if (code >= 80 && code <= 82) {
    return {
      label: 'Hujan Lebat',
      emoji: '🌧️',
      color: '#3B82F6',
      advisory: 'Hujan deras; periksa saluran air blok rendah dan waspadai jalan kebun licin.',
    };
  }
  if (code >= 95) {
    return {
      label: 'Hujan Petir / Badai',
      emoji: '⛈️',
      color: '#EF4444',
      advisory: 'Peringatan cuaca ekstrem: hentikan aktivitas lapangan terbuka dan operasional drone.',
    };
  }
  return {
    label: 'Berawan',
    emoji: '⛅',
    color: '#38BDF8',
    advisory: 'Kondisi cuaca normal operasional perkebunan.',
  };
}

export function formatCompassDirection(deg: number): string {
  const dirs = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}

function formatDayNameId(isoDate: string, idx: number): string {
  if (idx === 0) return 'Hari Ini';
  if (idx === 1) return 'Besok';
  try {
    return new Date(`${isoDate}T00:00:00`).toLocaleDateString('id-ID', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return isoDate;
  }
}

const weatherMemoryCache = new Map<string, { expiresAt: number; data: LocationWeatherReport }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function fetchBmkgAgroWeather(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<LocationWeatherReport> {
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = weatherMemoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '3',
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
    signal,
  });

  if (!res.ok) {
    throw new Error(`Gagal memuat data cuaca (${res.status})`);
  }

  const json = await res.json();
  const current = json.current || {};
  const daily = json.daily || {};

  const code = Number(current.weather_code ?? 1);
  const meta = classifyWmoWeatherCode(code);

  const times: string[] = Array.isArray(daily.time) ? daily.time : [];
  const dailyForecast: DailyWeatherForecast[] = times.slice(0, 3).map((d, i) => {
    const dCode = Number(daily.weather_code?.[i] ?? code);
    const dMeta = classifyWmoWeatherCode(dCode);
    return {
      date: d,
      dayName: formatDayNameId(d, i),
      weatherCode: dCode,
      conditionLabel: dMeta.label,
      conditionEmoji: dMeta.emoji,
      tempMaxC: Number(Number(daily.temperature_2m_max?.[i] ?? current.temperature_2m ?? 30).toFixed(1)),
      tempMinC: Number(Number(daily.temperature_2m_min?.[i] ?? 23).toFixed(1)),
      precipitationMm: Number(Number(daily.precipitation_sum?.[i] ?? 0).toFixed(1)),
      precipitationProbPct: Number(daily.precipitation_probability_max?.[i] ?? 0),
    };
  });

  const report: LocationWeatherReport = {
    lat,
    lng,
    temperatureC: Number(Number(current.temperature_2m ?? 29).toFixed(1)),
    apparentTempC: Number(Number(current.apparent_temperature ?? current.temperature_2m ?? 30).toFixed(1)),
    humidityPct: Number(current.relative_humidity_2m ?? 75),
    precipitationMm: Number(Number(current.precipitation ?? 0).toFixed(1)),
    windSpeedKmh: Number(Number(current.wind_speed_10m ?? 8).toFixed(1)),
    windDirectionDeg: Number(current.wind_direction_10m ?? 90),
    weatherCode: code,
    conditionLabel: meta.label,
    conditionEmoji: meta.emoji,
    accentColor: meta.color,
    agroAdvisory: meta.advisory,
    updatedAt: new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    dailyForecast,
  };

  weatherMemoryCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    data: report,
  });

  return report;
}

let cachedRainRadarTileUrl: { expiresAt: number; tileUrl: string | null; frameTime: string | null } | null =
  null;

export async function fetchLatestRainRadarTileUrl(
  signal?: AbortSignal
): Promise<{ tileUrl: string | null; frameTime: string | null }> {
  if (cachedRainRadarTileUrl && cachedRainRadarTileUrl.expiresAt > Date.now()) {
    return {
      tileUrl: cachedRainRadarTileUrl.tileUrl,
      frameTime: cachedRainRadarTileUrl.frameTime,
    };
  }

  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal });
    if (!res.ok) return { tileUrl: null, frameTime: null };
    const json = await res.json();
    const host = json?.host || 'https://tilecache.rainviewer.com';
    const pastFrames = json?.radar?.past;
    if (!Array.isArray(pastFrames) || pastFrames.length === 0) {
      return { tileUrl: null, frameTime: null };
    }
    const latest = pastFrames[pastFrames.length - 1];
    if (!latest?.path) return { tileUrl: null, frameTime: null };

    const tileUrl = `${host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
    const frameTime = latest.time
      ? new Date(Number(latest.time) * 1000).toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

    cachedRainRadarTileUrl = {
      expiresAt: Date.now() + 5 * 60 * 1000,
      tileUrl,
      frameTime,
    };

    return { tileUrl, frameTime };
  } catch {
    return { tileUrl: null, frameTime: null };
  }
}
