import fs from "node:fs/promises";
import axios, { AxiosInstance } from "axios";

type Mode = "stealth" | "verbose";

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
};

type IssNowResponse = {
  message: "success";
  timestamp: number;
  iss_position: {
    latitude: string;
    longitude: string;
  };
};

type SpaceXNextLaunch = {
  name: string;
  date_utc: string;
  details: string | null;
  links?: {
    webcast?: string | null;
    patch?: { small?: string | null; large?: string | null };
  };
};

type NasaApod = {
  date: string;
  title: string;
  explanation: string;
  media_type: "image" | "video";
  url: string;
};

type NasaNeoFeed = {
  near_earth_objects: Record<string, NasaNeo[]>;
};

type NasaNeo = {
  name: string;
  is_potentially_hazardous_asteroid: boolean;
  estimated_diameter: {
    meters: {
      estimated_diameter_min: number;
      estimated_diameter_max: number;
    };
  };
  close_approach_data: Array<{
    close_approach_date: string;
    miss_distance: {
      kilometers: string;
    };
  }>;
};

type Location = {
  city: string;
  displayName: string;
  latitude: number;
  longitude: number;
};

type NeoSummary = {
  days: number;
  totalCount: number;
  hazardousCount: number;
  maxEstimatedDiameterMeters: number;
  minMissDistanceKm: number;
  buckets: {
    lt3: number;
    gte3lt4: number;
    gte4: number;
  };
};

type Briefing = {
  generatedAt: string;
  input: {
    city: string;
    days: number;
    date: string;
    mode: Mode;
  };
  location: Location;
  iss: {
    latitude: number;
    longitude: number;
    distanceKm: number;
    timestamp: number;
  };
  nextLaunch: {
    name: string;
    dateUtc: string;
    hoursToLaunch: number;
    webcast?: string | null;
  };
  apod: {
    date: string;
    title: string;
    mediaType: string;
    url: string;
  };
  neo: NeoSummary;
  threat: {
    score: number;
    level: "LOW" | "MEDIUM" | "HIGH";
  };
};

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const OPEN_NOTIFY_BASE = "http://api.open-notify.org";
const SPACEX_BASE = "https://api.spacexdata.com";
const NASA_BASE = "https://api.nasa.gov";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = args[i + 1];
    if (value && !value.startsWith("--")) {
      parsed[key] = value;
      i++;
    } else {
      parsed[key] = "true";
    }
  }

  const city = parsed.city;
  const days = Number(parsed.days ?? "3");
  const mode = (parsed.mode ?? "stealth") as Mode;
  const date = parsed.date ?? new Date().toISOString().slice(0, 10);

  if (!city) throw new Error('Missing required argument: --city "City Name"');
  if (!days || Number.isNaN(days) || days < 1)
    throw new Error("Missing or invalid argument: --days <number>");
  if (mode !== "stealth" && mode !== "verbose")
    throw new Error("Invalid --mode. Use stealth or verbose.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("Invalid --date. Use YYYY-MM-DD.");

  return { city, days, mode, date };
}

function makeLogger(mode: Mode) {
  const verbose = mode === "verbose";
  return {
    verbose,
    log: (...a: any[]) => {
      if (verbose) console.log("[debug]", ...a);
    },
    info: (...a: any[]) => console.log(...a),
  };
}

function addDays(yyyyMmDd: string, days: number) {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function timed<T>(
  name: string,
  fn: () => Promise<{ status: number; data: T }>,
  log: (meta: {
    name: string;
    ms: number;
    status?: number;
    ok: boolean;
  }) => void
) {
  const start = Date.now();
  try {
    const res = await fn();
    log({ name, ms: Date.now() - start, status: res.status, ok: true });
    return res;
  } catch {
    log({ name, ms: Date.now() - start, ok: false });
    throw new Error(`${name} failed`);
  }
}

function makeClient(
  baseURL: string,
  headers?: Record<string, string>
): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: 15_000,
    headers: {
      Accept: "application/json, text/plain, */*",
      ...headers,
    },
    validateStatus: () => true,
  });
}

async function getCityLocation(
  nominatim: AxiosInstance,
  city: string,
  logger: ReturnType<typeof makeLogger>
): Promise<Location> {
  const res = await timed<NominatimResponse>(
    "Nominatim search",
    () =>
      nominatim.get("/search", {
        params: { format: "json", q: city, limit: 1 },
      }),
    (m) => logger.log(m)
  );

  if (res.status >= 400) throw new Error(`Nominatim HTTP ${res.status}`);
  const results = res.data as NominatimResult[];
  const first = results?.[0];
  if (!first) throw new Error(`City not found: ${city}`);

  const latitude = Number(first.lat);
  const longitude = Number(first.lon);
  if (Number.isNaN(latitude) || Number.isNaN(longitude))
    throw new Error(`Invalid coordinates for: ${city}`);

  return {
    city,
    displayName: first.display_name,
    latitude,
    longitude,
  };
}

async function getIssNow(
  openNotify: AxiosInstance,
  logger: ReturnType<typeof makeLogger>
) {
  const res = await timed<IssNowResponse>(
    "ISS now",
    () => openNotify.get("/iss-now.json"),
    (m) => logger.log(m)
  );
  if (res.status >= 400) throw new Error(`ISS HTTP ${res.status}`);

  const lat = Number(res.data.iss_position.latitude);
  const lon = Number(res.data.iss_position.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lon))
    throw new Error("Invalid ISS coordinates");

  return {
    latitude: lat,
    longitude: lon,
    timestamp: res.data.timestamp,
  };
}

async function getSpaceXNext(
  spacex: AxiosInstance,
  logger: ReturnType<typeof makeLogger>
): Promise<SpaceXNextLaunch> {
  const res = await timed<SpaceXNextLaunch>(
    "SpaceX next",
    () => spacex.get("/v4/launches/next"),
    (m) => logger.log(m)
  );
  if (res.status >= 400) throw new Error(`SpaceX HTTP ${res.status}`);
  return res.data;
}

async function getApod(
  nasa: AxiosInstance,
  apiKey: string,
  date: string,
  logger: ReturnType<typeof makeLogger>
): Promise<NasaApod> {
  const res = await timed<NasaApod>(
    "NASA APOD",
    () =>
      nasa.get("/planetary/apod", {
        params: { api_key: apiKey, date },
      }),
    (m) => logger.log(m)
  );
  if (res.status >= 400) throw new Error(`APOD HTTP ${res.status}`);
  return res.data;
}

async function getNeoFeed(
  nasa: AxiosInstance,
  apiKey: string,
  startDate: string,
  endDate: string,
  logger: ReturnType<typeof makeLogger>
): Promise<NasaNeoFeed> {
  const res = await timed<NasaNeoFeed>(
    "NASA NEO feed",
    () =>
      nasa.get("/neo/rest/v1/feed", {
        params: { api_key: apiKey, start_date: startDate, end_date: endDate },
      }),
    (m) => logger.log(m)
  );
  if (res.status >= 400) throw new Error(`NEO HTTP ${res.status}`);
  return res.data;
}

function summarizeNeos(feed: NasaNeoFeed, days: number): NeoSummary {
  const all: NasaNeo[] = [];
  for (const k of Object.keys(feed.near_earth_objects ?? {})) {
    const arr = feed.near_earth_objects[k];
    if (Array.isArray(arr)) all.push(...arr);
  }

  let totalCount = 0;
  let hazardousCount = 0;
  let maxEstimatedDiameterMeters = 0;
  let minMissDistanceKm = Number.POSITIVE_INFINITY;

  let lt3 = 0;
  let gte3lt4 = 0;
  let gte4 = 0;

  for (const neo of all) {
    totalCount++;
    if (neo.is_potentially_hazardous_asteroid) hazardousCount++;

    const d = neo.estimated_diameter?.meters?.estimated_diameter_max;
    if (typeof d === "number" && d > maxEstimatedDiameterMeters)
      maxEstimatedDiameterMeters = d;

    const magGuess = neo.is_potentially_hazardous_asteroid ? 4.0 : 2.9;
    if (magGuess < 3) lt3++;
    else if (magGuess < 4) gte3lt4++;
    else gte4++;

    const miss = neo.close_approach_data?.[0]?.miss_distance?.kilometers;
    const missKm = miss ? Number(miss) : Number.POSITIVE_INFINITY;
    if (!Number.isNaN(missKm) && missKm < minMissDistanceKm)
      minMissDistanceKm = missKm;
  }

  if (!Number.isFinite(minMissDistanceKm)) minMissDistanceKm = 0;

  return {
    days,
    totalCount,
    hazardousCount,
    maxEstimatedDiameterMeters,
    minMissDistanceKm,
    buckets: { lt3, gte3lt4, gte4 },
  };
}

function computeThreat(
  neo: NeoSummary,
  issDistanceKm: number,
  hoursToLaunch: number
) {
  const missRisk =
    neo.minMissDistanceKm === 0
      ? 0
      : Math.max(0, 3 - neo.minMissDistanceKm / 1_000_000);
  const sizeRisk = Math.min(5, neo.maxEstimatedDiameterMeters / 100);
  const issRisk = Math.max(0, 2 - issDistanceKm / 2_000);
  const launchRisk = Math.max(0, 2 - hoursToLaunch / 24);

  const score = Math.round(
    neo.hazardousCount * 3 +
      neo.totalCount * 0.2 +
      missRisk * 4 +
      sizeRisk * 2 +
      issRisk * 2 +
      launchRisk * 1
  );

  const level: "HIGH" | "MEDIUM" | "LOW" =
    score >= 18 ? "HIGH" : score >= 10 ? "MEDIUM" : "LOW";
  return { score, level };
}

async function main() {
  const { city, days, mode, date } = parseArgs(process.argv);
  const logger = makeLogger(mode);

  const nominatim = makeClient(NOMINATIM_BASE, {
    "User-Agent": "spaceops-briefing/1.0 (contact: local)",
  });
  const openNotify = makeClient(OPEN_NOTIFY_BASE);
  const spacex = makeClient(SPACEX_BASE);
  const nasa = makeClient(NASA_BASE);

  const nasaKey = process.env.NASA_API_KEY ?? "DEMO_KEY";

  const neoDays = Math.min(days, 7);
  const startDate = date;
  const endDate = addDays(date, neoDays - 1);

  const location = await getCityLocation(nominatim, city, logger);

  const [issNow, nextLaunch, apod, neoFeed] = await Promise.all([
    getIssNow(openNotify, logger),
    getSpaceXNext(spacex, logger),
    getApod(nasa, nasaKey, date, logger),
    getNeoFeed(nasa, nasaKey, startDate, endDate, logger),
  ]);

  const issDistanceKm = haversineKm(
    location.latitude,
    location.longitude,
    issNow.latitude,
    issNow.longitude
  );

  const launchMs = Date.parse(nextLaunch.date_utc);
  const hoursToLaunch = Number.isFinite(launchMs)
    ? (launchMs - Date.now()) / 3_600_000
    : 0;

  const neoSummary = summarizeNeos(neoFeed, neoDays);
  const threat = computeThreat(neoSummary, issDistanceKm, hoursToLaunch);

  const briefing: Briefing = {
    generatedAt: new Date().toISOString(),
    input: { city, days, date, mode },
    location,
    iss: {
      latitude: issNow.latitude,
      longitude: issNow.longitude,
      distanceKm: issDistanceKm,
      timestamp: issNow.timestamp,
    },
    nextLaunch: {
      name: nextLaunch.name,
      dateUtc: nextLaunch.date_utc,
      hoursToLaunch,
      webcast: nextLaunch.links?.webcast ?? null,
    },
    apod: {
      date: apod.date,
      title: apod.title,
      mediaType: apod.media_type,
      url: apod.url,
    },
    neo: neoSummary,
    threat,
  };

  await fs.writeFile(
    "briefing.json",
    JSON.stringify(briefing, null, 2),
    "utf-8"
  );

  logger.info(`Mission Briefing: ${location.displayName}`);
  logger.info(`Date: ${date}`);
  logger.info(`ISS distance: ${issDistanceKm.toFixed(0)} km`);
  logger.info(
    `Next launch: ${nextLaunch.name} (${hoursToLaunch.toFixed(1)} hours)`
  );
  logger.info(`APOD: ${apod.title}`);
  logger.info(
    `NEOs (${neoDays} days): ${neoSummary.totalCount} | hazardous: ${
      neoSummary.hazardousCount
    } | closest miss: ${neoSummary.minMissDistanceKm.toFixed(
      0
    )} km | largest est: ${neoSummary.maxEstimatedDiameterMeters.toFixed(0)} m`
  );
  logger.info(`Threat Level: ${threat.level} (score ${threat.score})`);
  logger.info(`Saved: briefing.json`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

type NominatimResponse = NominatimResult[];
