import { createApiClient } from "../global.client";

/* ------------------ API CLIENTS ------------------ */
const geoApi = createApiClient({
  baseUrl: "https://geocoding-api.open-meteo.com",
});

const weatherApi = createApiClient({
  baseUrl: "https://api.open-meteo.com",
});

/* ------------------ TYPES ------------------ */
type GeocodingResult = {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
};

type GeocodingResponse = {
  results?: GeocodingResult[];
};

type DailyForecast = {
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
};

type ForecastResponse = {
  daily?: DailyForecast;
};

/* ------------------ HELPERS ------------------ */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i += 2) {
    parsed[args[i].replace("--", "")] = args[i + 1];
  }

  const city = parsed.city;
  const days = Number(parsed.days);

  if (!city) throw new Error("Missing --city");
  if (!days || Number.isNaN(days)) throw new Error("Missing or invalid --days");

  return { city, days };
}

/* ------------------ API CALLS ------------------ */
async function getCityCoordinates(city: string) {
  const res = await geoApi.get<GeocodingResponse>("/v1/search", {
    params: { name: city, count: 1 },
  });

  const result = res.data.results?.[0];
  if (!result) {
    throw new Error(`City not found: ${city}`);
  }

  return {
    city: result.name,
    country: result.country,
    latitude: result.latitude,
    longitude: result.longitude,
  };
}

async function getForecast(latitude: number, longitude: number, days: number) {
  const res = await weatherApi.get<ForecastResponse>("/v1/forecast", {
    params: {
      latitude,
      longitude,
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
      forecast_days: days,
      timezone: "auto",
    },
  });

  if (!res.data.daily) {
    throw new Error("Forecast data missing");
  }

  return res.data.daily;
}

/* ------------------ PURE COMPUTATION ------------------ */
function computeSummary(daily: DailyForecast) {
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    avgMaxTemp: avg(daily.temperature_2m_max),
    avgMinTemp: avg(daily.temperature_2m_min),
    totalPrecipitation: daily.precipitation_sum.reduce((a, b) => a + b, 0),
  };
}

/* ------------------ MAIN ------------------ */
async function main() {
  const { city, days } = parseArgs();

  const location = await getCityCoordinates(city);
  const forecast = await getForecast(
    location.latitude,
    location.longitude,
    days
  );

  const summary = computeSummary(forecast);

  console.log(`City: ${location.city}, ${location.country}`);
  console.log(`Days analyzed: ${days}`);
  console.log(`Avg max temp: ${summary.avgMaxTemp.toFixed(1)} °C`);
  console.log(`Avg min temp: ${summary.avgMinTemp.toFixed(1)} °C`);
  console.log(
    `Total precipitation: ${summary.totalPrecipitation.toFixed(1)} mm`
  );
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
