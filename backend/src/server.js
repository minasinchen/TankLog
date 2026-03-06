require("dotenv").config();

const bcrypt = require("bcrypt");
const cors = require("cors");
const express = require("express");
const fs = require("fs");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const FUEL_TYPE_MAP = {
  PETROL: "PETROL",
  BENZIN: "PETROL",
  DIESEL: "DIESEL",
  HYBRID_PETROL: "HYBRID_PETROL",
  "HYBRID (BENZIN)": "HYBRID_PETROL",
  HYBRID_BENZIN: "HYBRID_PETROL",
  HYBRID_DIESEL: "HYBRID_DIESEL",
  "HYBRID (DIESEL)": "HYBRID_DIESEL",
  ELECTRIC: "ELECTRIC",
  ELEKTRO: "ELECTRIC",
  LPG: "LPG",
  CNG: "CNG",
  OTHER: "OTHER",
  SONSTIGES: "OTHER"
};
const PRICE_HISTORY_PATH = "/data/fuel-price-history.json";
const PRICE_FAVORITES_PATH = "/data/fuel-price-favorites.json";
const PRICE_PATTERNS_PATH = "/data/fuel-price-patterns.json";
const GARAGE_SETTINGS_PATH = "/data/garage-settings.json";
const PRICE_HISTORY_RETENTION_DAYS = 365;
const HOURLY_WINDOW_DAYS = 7;
const RAW_WINDOW_DAYS = 30;
const PRICE_LOOKBACK_DAYS = 30;
const PRICE_HALF_YEAR_LOOKBACK_DAYS = 180;
const MIN_EXTERNAL_SAMPLE_INTERVAL_MS = 60 * 60 * 1000;
const RAW_FUEL_PRICE_CACHE_MINUTES = Number.parseInt(
  process.env.FUEL_PRICE_CACHE_MINUTES || "60",
  10
);
const FUEL_PRICE_CACHE_MINUTES = Number.isFinite(RAW_FUEL_PRICE_CACHE_MINUTES)
  ? Math.max(5, Math.min(24 * 60, RAW_FUEL_PRICE_CACHE_MINUTES))
  : 60;
const PRICE_CACHE_TTL_MS = FUEL_PRICE_CACHE_MINUTES * 60 * 1000;
const PRICE_SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;
const ENABLE_BACKGROUND_SNAPSHOTS = String(process.env.FUEL_PRICE_BACKGROUND_SNAPSHOTS || "false")
  .trim()
  .toLowerCase() === "true";
const FUEL_PRICE_PROVIDER = String(process.env.FUEL_PRICE_PROVIDER || "tankerkoenig")
  .trim()
  .toLowerCase();
const TANKERKOENIG_API_KEY = String(process.env.TANKERKOENIG_API_KEY || "").trim();
const TANKERKOENIG_STATION_IDS = String(process.env.TANKERKOENIG_STATION_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const TANKERKOENIG_STATION_IDS_BY_GARAGE = (() => {
  const raw = String(process.env.TANKERKOENIG_STATION_IDS_BY_GARAGE || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result = {};
    for (const [garageName, stationList] of Object.entries(parsed)) {
      if (!Array.isArray(stationList)) continue;
      const key = String(garageName || "").trim().toLowerCase();
      if (!key) continue;
      result[key] = stationList
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    }
    return result;
  } catch {
    return {};
  }
})();
const RAW_CHEAP_THRESHOLD_PCT = Number.parseFloat(
  process.env.FUEL_PRICE_CHEAP_THRESHOLD_PCT || "5"
);
const CHEAP_THRESHOLD_PCT = Number.isFinite(RAW_CHEAP_THRESHOLD_PCT)
  ? Math.max(0, Math.min(30, RAW_CHEAP_THRESHOLD_PCT))
  : 5;
const fuelInsightCache = new Map();
const stationNameCache = new Map();
const stationDetailCache = new Map();
const GARAGE_DEFAULT_COORDS = {
  moorgarage: { lat: 53.0793, lng: 8.8017, radius: 20 },
  fehngarage: { lat: 53.0736, lng: 7.4044, radius: 20 }
};
const PRICE_SCOPE_VALUES = new Set(["favorites", "all"]);
const TANKERKOENIG_PRICE_IDS_MAX = 10;
let loginTriggeredSnapshotStarted = false;
let loginTriggeredSnapshotRunning = false;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required");
}

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS origin not allowed"));
    }
  })
);
app.use(express.json());
app.use(morgan("combined"));

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function normalizeFuelType(value) {
  if (value === undefined || value === null || value === "") {
    return "OTHER";
  }

  const normalized = String(value).trim().toUpperCase();
  const fuelType = FUEL_TYPE_MAP[normalized];

  if (!fuelType) {
    throw httpError(400, "Unsupported fuelType");
  }

  return fuelType;
}

function normalizePetrolVariant(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "e10" ? "e10" : "e5";
}

function resolveFuelSeriesKey(fuelType, petrolVariant) {
  if (fuelType === "PETROL" || fuelType === "HYBRID_PETROL") {
    return petrolVariant === "e10" ? "PETROL_E10" : "PETROL_E5";
  }
  return fuelType;
}

function parseDateValue(value, fieldName, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw httpError(400, `${fieldName} is required`);
    }
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw httpError(400, `${fieldName} must be a valid date`);
  }

  return date;
}

function parseIntValue(value, fieldName, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw httpError(400, `${fieldName} is required`);
    }
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw httpError(400, `${fieldName} must be an integer`);
  }

  return parsed;
}

function parseDecimalValue(value, fieldName, scale = 2, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw httpError(400, `${fieldName} is required`);
    }
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw httpError(400, `${fieldName} must be numeric`);
  }

  return parsed.toFixed(scale);
}

function parseBooleanValue(value, defaultValue = false) {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.toLowerCase());
  }

  return Boolean(value);
}

function mapFuelTypeToTankerKey(fuelType) {
  switch (fuelType) {
    case "PETROL_E10":
      return "e10";
    case "PETROL_E5":
    case "PETROL":
    case "HYBRID_PETROL":
      return "e5";
    case "DIESEL":
    case "HYBRID_DIESEL":
      return "diesel";
    default:
      return null;
  }
}

function resolveGarageCoordsByName(garageName) {
  const garageKey = String(garageName || "").trim().toLowerCase();
  return GARAGE_DEFAULT_COORDS[garageKey] || { lat: 53.0793, lng: 8.8017, radius: 25 };
}

function resolveStationIdsForGarage(garageName) {
  const key = String(garageName || "").trim().toLowerCase();
  const specific = key ? (TANKERKOENIG_STATION_IDS_BY_GARAGE[key] || []) : [];
  if (specific.length) {
    return specific;
  }
  return TANKERKOENIG_STATION_IDS;
}

function getGarageFavoriteStationIds(garageId) {
  const data = readPriceFavorites();
  const list = data[garageId];
  if (!Array.isArray(list)) return [];
  return list
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function resolveScopeValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return PRICE_SCOPE_VALUES.has(normalized) ? normalized : "favorites";
}

function resolveStationIdsByScope(garageId, garageName, scope) {
  const fallbackStationIds = resolveStationIdsForGarage(garageName);
  if (scope === "all") {
    return { stationIds: fallbackStationIds, stationSource: "defaults" };
  }
  const favorites = getGarageFavoriteStationIds(garageId);
  if (favorites.length) {
    return { stationIds: favorites, stationSource: "favorites" };
  }
  return { stationIds: fallbackStationIds, stationSource: "defaults" };
}

function toHourBucketIso(date) {
  const dt = new Date(date);
  dt.setMinutes(0, 0, 0);
  return dt.toISOString();
}

function readPriceHistory() {
  try {
    if (!fs.existsSync(PRICE_HISTORY_PATH)) {
      return [];
    }
    const parsed = JSON.parse(fs.readFileSync(PRICE_HISTORY_PATH, "utf8"));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry) => entry && typeof entry === "object");
  } catch {
    return [];
  }
}

function readPriceFavorites() {
  try {
    if (!fs.existsSync(PRICE_FAVORITES_PATH)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(PRICE_FAVORITES_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writePriceFavorites(data) {
  fs.mkdirSync(path.dirname(PRICE_FAVORITES_PATH), { recursive: true });
  fs.writeFileSync(PRICE_FAVORITES_PATH, JSON.stringify(data, null, 2) + "\n");
}

function readPricePatterns() {
  try {
    if (!fs.existsSync(PRICE_PATTERNS_PATH)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(PRICE_PATTERNS_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function readGarageSettingsStore() {
  try {
    if (!fs.existsSync(GARAGE_SETTINGS_PATH)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(GARAGE_SETTINGS_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeGarageSettingsStore(data) {
  fs.mkdirSync(path.dirname(GARAGE_SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(GARAGE_SETTINGS_PATH, JSON.stringify(data, null, 2) + "\n");
}

function getGarageSettings(garageId) {
  const store = readGarageSettingsStore();
  const raw = store[garageId] || {};
  return {
    warnConsumption: Number.isFinite(Number(raw.warnConsumption))
      ? Math.max(1, Math.min(60, Number(raw.warnConsumption)))
      : 25,
    remindDays: Number.isFinite(Number(raw.remindDays))
      ? Math.max(1, Math.min(180, Number(raw.remindDays)))
      : 14,
    petrolVariant: normalizePetrolVariant(raw.petrolVariant)
  };
}

function saveGarageSettings(garageId, input) {
  const next = {
    warnConsumption: Number.isFinite(Number(input.warnConsumption))
      ? Math.max(1, Math.min(60, Number(input.warnConsumption)))
      : 25,
    remindDays: Number.isFinite(Number(input.remindDays))
      ? Math.max(1, Math.min(180, Number(input.remindDays)))
      : 14,
    petrolVariant: normalizePetrolVariant(input.petrolVariant)
  };
  const store = readGarageSettingsStore();
  store[garageId] = next;
  writeGarageSettingsStore(store);
  return next;
}

function writePricePatterns(data) {
  fs.mkdirSync(path.dirname(PRICE_PATTERNS_PATH), { recursive: true });
  fs.writeFileSync(PRICE_PATTERNS_PATH, JSON.stringify(data, null, 2) + "\n");
}

function writePriceHistory(entries) {
  fs.mkdirSync(path.dirname(PRICE_HISTORY_PATH), { recursive: true });
  fs.writeFileSync(PRICE_HISTORY_PATH, JSON.stringify(entries, null, 2) + "\n");
}

function compactPriceHistory(entries, now = new Date()) {
  const retentionCutoff = now.getTime() - PRICE_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const rawCutoff = now.getTime() - RAW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const hourlyByBucket = new Map();
  const oldDailyBuckets = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts) || ts < retentionCutoff) continue;
    const garageId = String(entry.garageId || "").trim();
    const fuelType = String(entry.fuelType || "").trim();
    const mode = resolveScopeValue(entry.mode || "favorites");
    const price = Number(entry.price);
    if (!garageId || !fuelType || !Number.isFinite(price) || price <= 0) continue;

    if (ts >= rawCutoff) {
      const hourTs = toHourBucketIso(ts);
      const key = `${garageId}|${fuelType}|${mode}|${hourTs}`;
      hourlyByBucket.set(key, {
        timestamp: hourTs,
        garageId,
        fuelType,
        mode,
        resolution: "hour",
        stationId: entry.stationId || null,
        stationName: entry.stationName || null,
        price: Number(price.toFixed(3))
      });
      continue;
    }

    const day = toDateOnly(ts);
    const key = `${garageId}|${fuelType}|${mode}|${day}`;
    const prev = oldDailyBuckets.get(key) || { sum: 0, count: 0, garageId, fuelType, mode, day };
    prev.sum += price;
    prev.count += 1;
    oldDailyBuckets.set(key, prev);
  }

  const olderDaily = [...oldDailyBuckets.values()].map((bucket) => ({
    timestamp: `${bucket.day}T12:00:00.000Z`,
    garageId: bucket.garageId,
    fuelType: bucket.fuelType,
    mode: bucket.mode,
    resolution: "day",
    price: Number((bucket.sum / bucket.count).toFixed(3))
  }));

  const hourly = [...hourlyByBucket.values()];
  return [...olderDaily, ...hourly].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function computeMedian(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function computeAverage(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toDateOnly(value) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

function buildDailyAvgSeries(entries, garageId, fuelType, mode, now = new Date(), lookbackDays = PRICE_LOOKBACK_DAYS) {
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  const byDate = new Map();

  for (const entry of entries) {
    if (entry.garageId !== garageId || entry.fuelType !== fuelType) continue;
    if (resolveScopeValue(entry.mode) !== mode) continue;
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const date = toDateOnly(entry.timestamp);
    if (!date || !Number.isFinite(entry.price)) continue;

    const prev = byDate.get(date) || { sum: 0, count: 0 };
    prev.sum += Number(entry.price);
    prev.count += 1;
    byDate.set(date, prev);
  }

  return [...byDate.entries()]
    .map(([date, v]) => ({
      date,
      price: Number((v.sum / v.count).toFixed(3))
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildHourlyAvgSeries(entries, garageId, fuelType, mode, now = new Date(), lookbackDays = HOURLY_WINDOW_DAYS) {
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  const byHour = new Map();

  for (const entry of entries) {
    if (entry.garageId !== garageId || entry.fuelType !== fuelType) continue;
    if (resolveScopeValue(entry.mode) !== mode) continue;
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    if ((entry.resolution || "hour") !== "hour") continue;
    if (!Number.isFinite(entry.price)) continue;
    const hourIso = toHourBucketIso(ts);
    const prev = byHour.get(hourIso) || { sum: 0, count: 0 };
    prev.sum += Number(entry.price);
    prev.count += 1;
    byHour.set(hourIso, prev);
  }

  return [...byHour.entries()]
    .map(([timestamp, v]) => ({
      timestamp,
      price: Number((v.sum / v.count).toFixed(3))
    }))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function findLatestSample(entries, garageId, fuelType, mode) {
  let latest = null;
  for (const entry of entries) {
    if (entry.garageId !== garageId || entry.fuelType !== fuelType) continue;
    if (resolveScopeValue(entry.mode) !== mode) continue;
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (!latest || ts > latest.ts) {
      latest = {
        ts,
        timestamp: new Date(ts).toISOString(),
        stationId: entry.stationId || null,
        stationName: entry.stationName || null,
        price: Number(entry.price)
      };
    }
  }
  return latest;
}

function buildTimingPattern(entries, garageId, fuelType, mode, now = new Date(), lookbackDays = 60) {
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  const buckets = new Map();

  for (const entry of entries) {
    if (entry.garageId !== garageId || entry.fuelType !== fuelType) continue;
    if (resolveScopeValue(entry.mode) !== mode) continue;
    if ((entry.resolution || "hour") !== "hour") continue;
    const ts = Date.parse(entry.timestamp);
    const price = Number(entry.price);
    if (!Number.isFinite(ts) || ts < cutoff || !Number.isFinite(price)) continue;
    const dt = new Date(ts);
    const key = `${dt.getUTCDay()}-${dt.getUTCHours()}`;
    const prev = buckets.get(key) || { sum: 0, count: 0, weekday: dt.getUTCDay(), hour: dt.getUTCHours() };
    prev.sum += price;
    prev.count += 1;
    buckets.set(key, prev);
  }

  if (!buckets.size) return null;
  const weekdayLabels = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  let best = null;
  for (const bucket of buckets.values()) {
    const avg = bucket.sum / bucket.count;
    if (!best || avg < best.avgPrice) {
      best = {
        weekday: bucket.weekday,
        hour: bucket.hour,
        avgPrice: Number(avg.toFixed(3)),
        samples: bucket.count
      };
    }
  }
  if (!best) return null;
  best.label = `${weekdayLabels[best.weekday]} ca. ${String(best.hour).padStart(2, "0")}:00`;
  best.generatedAt = now.toISOString();
  return best;
}

function buildPriceForecast(dailySeries) {
  if (!Array.isArray(dailySeries) || dailySeries.length < 6) {
    return null;
  }

  const prices = dailySeries.map((item) => item.price).filter(Number.isFinite);
  if (prices.length < 6) {
    return null;
  }

  const last7 = prices.slice(-7);
  const prev7 = prices.slice(-14, -7);
  const lastAvg = computeAverage(last7);
  const prevAvg = prev7.length ? computeAverage(prev7) : lastAvg;
  const trendPerDay = (lastAvg - prevAvg) / 7;
  const next = [];

  for (let i = 1; i <= 7; i += 1) {
    next.push(lastAvg + trendPerDay * i);
  }

  return {
    model: "linear-14d-trend",
    expectedMin: Number(Math.min(...next).toFixed(3)),
    expectedMax: Number(Math.max(...next).toFixed(3)),
    trendPerDay: Number(trendPerDay.toFixed(4))
  };
}

async function fetchTankerkoenigCurrentPrice(fuelType, stationIds) {
  if (!TANKERKOENIG_API_KEY || stationIds.length === 0) {
    return null;
  }

  const fuelKey = mapFuelTypeToTankerKey(fuelType);
  if (!fuelKey) {
    return {
      unsupportedFuelType: true
    };
  }

  let best = null;
  for (let index = 0; index < stationIds.length; index += TANKERKOENIG_PRICE_IDS_MAX) {
    const chunk = stationIds.slice(index, index + TANKERKOENIG_PRICE_IDS_MAX);
    const params = new URLSearchParams({
      ids: chunk.join(","),
      apikey: TANKERKOENIG_API_KEY
    });
    const url = `https://creativecommons.tankerkoenig.de/json/prices.php?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Upstream HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (!payload || payload.ok !== true || !payload.prices || typeof payload.prices !== "object") {
        throw new Error("Unexpected upstream payload");
      }

      for (const stationId of Object.keys(payload.prices)) {
        const station = payload.prices[stationId];
        if (!station || station.status !== "open") continue;
        const price = Number(station[fuelKey]);
        if (!Number.isFinite(price) || price <= 0) continue;
        if (!best || price < best.price) {
          best = {
            stationId,
            stationName: null,
            price: Number(price.toFixed(3))
          };
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return best;
}

async function fetchTankerkoenigStationName(stationId) {
  if (!stationId || !TANKERKOENIG_API_KEY) return null;
  const cached = stationNameCache.get(stationId);
  if (cached) return cached;

  const params = new URLSearchParams({
    id: stationId,
    apikey: TANKERKOENIG_API_KEY
  });
  const url = `https://creativecommons.tankerkoenig.de/json/detail.php?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json();
    const station = payload?.station;
    if (!station) return null;
    const labelParts = [station.brand, station.name, station.place].filter(Boolean);
    const label = labelParts.length ? labelParts.join(" · ") : null;
    if (label) {
      stationNameCache.set(stationId, label);
    }
    return label;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTankerkoenigStationDetail(stationId) {
  if (!stationId || !TANKERKOENIG_API_KEY) return null;
  const cached = stationDetailCache.get(stationId);
  if (cached) return cached;

  const params = new URLSearchParams({
    id: stationId,
    apikey: TANKERKOENIG_API_KEY
  });
  const url = `https://creativecommons.tankerkoenig.de/json/detail.php?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json();
    const station = payload?.station;
    if (!station) return null;
    const detail = {
      id: station.id || stationId,
      name: station.name || "",
      brand: station.brand || "",
      street: station.street || "",
      place: station.place || "",
      lat: Number.isFinite(Number(station.lat)) ? Number(station.lat) : null,
      lng: Number.isFinite(Number(station.lng)) ? Number(station.lng) : null
    };
    stationDetailCache.set(stationId, detail);
    return detail;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTankerkoenigPricesByStationIds(fuelType, stationIds) {
  if (!TANKERKOENIG_API_KEY || !Array.isArray(stationIds) || !stationIds.length) {
    return new Map();
  }
  const fuelKey = mapFuelTypeToTankerKey(fuelType);
  if (!fuelKey) return new Map();

  const prices = new Map();
  for (let index = 0; index < stationIds.length; index += TANKERKOENIG_PRICE_IDS_MAX) {
    const chunk = stationIds.slice(index, index + TANKERKOENIG_PRICE_IDS_MAX);
    const params = new URLSearchParams({
      ids: chunk.join(","),
      apikey: TANKERKOENIG_API_KEY
    });
    const url = `https://creativecommons.tankerkoenig.de/json/prices.php?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(url, { method: "GET", signal: controller.signal });
      if (!response.ok) continue;
      const payload = await response.json();
      if (!payload || payload.ok !== true || !payload.prices || typeof payload.prices !== "object") {
        continue;
      }
      for (const stationId of Object.keys(payload.prices)) {
        const station = payload.prices[stationId];
        if (!station || station.status !== "open") continue;
        const price = Number(station[fuelKey]);
        if (!Number.isFinite(price) || price <= 0) continue;
        prices.set(stationId, Number(price.toFixed(3)));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  return prices;
}

function appendPriceSample(entries, sample) {
  const next = [...entries];
  const hourTimestamp = toHourBucketIso(sample.timestamp);
  const targetKey = `${sample.garageId}|${sample.fuelType}|${sample.mode}|${hourTimestamp}`;
  const index = next.findIndex((entry) => {
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) return false;
    const key = `${entry.garageId}|${entry.fuelType}|${resolveScopeValue(entry.mode)}|${toHourBucketIso(ts)}`;
    return key === targetKey;
  });

  const normalized = {
    timestamp: hourTimestamp,
    garageId: sample.garageId,
    fuelType: sample.fuelType,
    mode: resolveScopeValue(sample.mode),
    resolution: "hour",
    stationId: sample.stationId || null,
    stationName: sample.stationName || null,
    price: Number(sample.price.toFixed(3))
  };

  if (index >= 0) {
    next[index] = normalized;
  } else {
    next.push(normalized);
  }
  return next;
}

function updatePricePatternStore(patternKey, pattern) {
  const store = readPricePatterns();
  if (pattern) {
    store[patternKey] = pattern;
  } else {
    delete store[patternKey];
  }
  writePricePatterns(store);
}

async function runPriceSnapshotJob() {
  if (FUEL_PRICE_PROVIDER !== "tankerkoenig" || !TANKERKOENIG_API_KEY) {
    return;
  }

  try {
    const garages = await prisma.garage.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" }
    });
    if (!garages.length) return;

    let history = readPriceHistory();
    const now = new Date();

    for (const garage of garages) {
      const fuelRows = await prisma.vehicle.findMany({
        where: { garageId: garage.id },
        select: { fuelType: true },
        distinct: ["fuelType"]
      });
      const fuelTypes = fuelRows
        .map((row) => row.fuelType)
        .filter((fuelType) => mapFuelTypeToTankerKey(fuelType));
      if (!fuelTypes.length) continue;

      for (const scope of ["all", "favorites"]) {
        const scoped = resolveStationIdsByScope(garage.id, garage.name, scope);
        if (!scoped.stationIds.length) continue;

        for (const fuelType of fuelTypes) {
          let current = null;
          try {
            current = await fetchTankerkoenigCurrentPrice(fuelType, scoped.stationIds);
          } catch {
            continue;
          }
          if (!current || current.unsupportedFuelType) continue;

          history = appendPriceSample(history, {
            timestamp: now.toISOString(),
            garageId: garage.id,
            fuelType,
            mode: scope,
            stationId: current.stationId,
            stationName: null,
            price: current.price
          });
        }
      }
    }

    const compacted = compactPriceHistory(history, now);
    writePriceHistory(compacted);

    for (const garage of garages) {
      for (const fuelType of ["DIESEL", "PETROL"]) {
        for (const scope of ["all", "favorites"]) {
          const pattern = buildTimingPattern(compacted, garage.id, fuelType, scope, now);
          updatePricePatternStore(`${garage.id}|${fuelType}|${scope}`, pattern);
        }
      }
    }
  } catch (error) {
    console.error("[price-snapshot] failed:", error.message);
  }
}

function triggerLoginGlobalSnapshotOnce() {
  if (ENABLE_BACKGROUND_SNAPSHOTS) return;
  if (loginTriggeredSnapshotStarted || loginTriggeredSnapshotRunning) return;
  loginTriggeredSnapshotStarted = true;
  loginTriggeredSnapshotRunning = true;
  console.log("[price-snapshot] login-trigger started (all garages, one-time)");
  runPriceSnapshotJob()
    .catch((error) => {
      console.error("[price-snapshot] login-trigger failed:", error.message);
    })
    .finally(() => {
      loginTriggeredSnapshotRunning = false;
      console.log("[price-snapshot] login-trigger finished");
    });
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      garageId: user.garageId,
      tokenVersion: user.tokenVersion
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function requireVehicleAccess(garageId, vehicleId) {
  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: vehicleId,
      garageId
    },
    select: {
      id: true
    }
  });

  if (!vehicle) {
    throw httpError(400, "vehicleId is invalid for this garage");
  }
}

async function loadRecordOr404(model, garageId, id) {
  const record = await model.findFirst({
    where: {
      id,
      garageId
    }
  });

  if (!record) {
    throw httpError(404, "Record not found");
  }
}

const authRequired = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw httpError(401, "Missing bearer token");
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    throw httpError(401, "Invalid or expired token");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      garageId: true,
      tokenVersion: true
    }
  });

  if (!user || user.tokenVersion !== payload.tokenVersion || user.garageId !== payload.garageId) {
    throw httpError(401, "Token is no longer valid");
  }

  req.auth = user;
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/auth/login", asyncHandler(async (req, res) => {
  const loginId = String(req.body.username || req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!loginId || !password) {
    throw httpError(400, "username and password are required");
  }

  const user = await prisma.user.findUnique({
    where: { email: loginId }
  });

  if (!user) {
    throw httpError(401, "Invalid credentials");
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    throw httpError(401, "Invalid credentials");
  }

  const token = signToken(user);
  triggerLoginGlobalSnapshotOnce();

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      garageId: user.garageId
    }
  });
}));

app.get("/auth/me", authRequired, asyncHandler(async (req, res) => {
  const garage = await prisma.garage.findUnique({
    where: { id: req.auth.garageId },
    select: {
      id: true,
      name: true
    }
  });

  res.json({
    user: {
      id: req.auth.id,
      email: req.auth.email,
      garageId: req.auth.garageId
    },
    garage
  });
}));

app.post("/auth/logout", authRequired, asyncHandler(async (req, res) => {
  await prisma.user.update({
    where: { id: req.auth.id },
    data: {
      tokenVersion: {
        increment: 1
      }
    }
  });

  res.json({ success: true });
}));

app.use("/api", authRequired);

app.get("/api/fuel-prices/stations/preferences", asyncHandler(async (req, res) => {
  const stationIds = getGarageFavoriteStationIds(req.auth.garageId);
  res.json({ stationIds });
}));

app.put("/api/fuel-prices/stations/preferences", asyncHandler(async (req, res) => {
  const input = Array.isArray(req.body.stationIds) ? req.body.stationIds : [];
  const stationIds = input
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (stationIds.length > 80) {
    throw httpError(400, "At most 80 station ids are allowed");
  }

  const data = readPriceFavorites();
  data[req.auth.garageId] = stationIds;
  writePriceFavorites(data);

  for (const key of fuelInsightCache.keys()) {
    if (key.startsWith(`${req.auth.garageId}:`)) {
      fuelInsightCache.delete(key);
    }
  }

  res.json({ stationIds });
}));

app.get("/api/fuel-prices/stations/search", asyncHandler(async (req, res) => {
  if (!TANKERKOENIG_API_KEY) {
    throw httpError(400, "TANKERKOENIG_API_KEY is required");
  }

  const garage = await prisma.garage.findUnique({
    where: { id: req.auth.garageId },
    select: { name: true }
  });
  const defaults = resolveGarageCoordsByName(garage?.name || "");

  const lat = Number.parseFloat(req.query.lat ?? defaults.lat);
  const lng = Number.parseFloat(req.query.lng ?? defaults.lng);
  const radius = Math.max(1, Math.min(25, Number.parseFloat(req.query.radius ?? defaults.radius)));
  const query = String(req.query.q || "").trim().toLowerCase();

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw httpError(400, "lat/lng must be valid numbers");
  }

  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    rad: String(radius),
    sort: "dist",
    type: "all",
    apikey: TANKERKOENIG_API_KEY
  });
  const url = `https://creativecommons.tankerkoenig.de/json/list.php?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (!response.ok) {
      throw httpError(502, `Upstream HTTP ${response.status}`);
    }
    const payload = await response.json();
    const stations = Array.isArray(payload?.stations) ? payload.stations : [];

    const results = stations
      .filter((station) => {
        if (!query) return true;
        const haystack = [
          station.name,
          station.brand,
          station.street,
          station.place
        ].join(" ").toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 30)
      .map((station) => ({
        id: station.id,
        name: station.name || "",
        brand: station.brand || "",
        street: station.street || "",
        place: station.place || "",
        distanceKm: Number.isFinite(station.dist) ? Number(station.dist.toFixed(1)) : null
      }));

    res.json({
      lat,
      lng,
      radius,
      stations: results
    });
  } finally {
    clearTimeout(timeout);
  }
}));

app.get("/api/fuel-prices/map-preview", asyncHandler(async (req, res) => {
  if (!TANKERKOENIG_API_KEY) {
    throw httpError(400, "TANKERKOENIG_API_KEY is required");
  }

  const requestedFuelType = normalizeFuelType(req.query.fuelType || req.query.fuel || "DIESEL");
  const petrolVariant = normalizePetrolVariant(req.query.fuelVariant || "e5");
  const seriesFuelType = resolveFuelSeriesKey(requestedFuelType, petrolVariant);
  const tankerType = mapFuelTypeToTankerKey(seriesFuelType);
  if (!tankerType) {
    throw httpError(400, "Fuel type is currently not supported for map preview");
  }

  const limit = Math.max(5, Math.min(80, Number.parseInt(req.query.limit || "20", 10) || 20));
  const scope = resolveScopeValue(req.query.scope || "all");
  const garage = await prisma.garage.findUnique({
    where: { id: req.auth.garageId },
    select: { id: true, name: true }
  });
  const defaults = resolveGarageCoordsByName(garage?.name || "");
  const lat = Number.parseFloat(req.query.lat ?? defaults.lat);
  const lng = Number.parseFloat(req.query.lng ?? defaults.lng);
  const radius = Math.max(1, Math.min(25, Number.parseFloat(req.query.radius ?? defaults.radius)));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw httpError(400, "lat/lng must be valid numbers");
  }

  if (scope === "favorites") {
    const scoped = resolveStationIdsByScope(req.auth.garageId, garage?.name || "", "favorites");
    const ids = [...new Set(scoped.stationIds)];
    const priceById = await fetchTankerkoenigPricesByStationIds(seriesFuelType, ids);
    const rows = [];
    for (const stationId of ids) {
      const price = priceById.get(stationId);
      if (!Number.isFinite(price)) continue;
      const detail = await fetchTankerkoenigStationDetail(stationId);
      const sLat = Number(detail?.lat);
      const sLng = Number(detail?.lng);
      rows.push({
        id: stationId,
        name: detail?.name || "",
        brand: detail?.brand || "",
        street: detail?.street || "",
        place: detail?.place || "",
        lat: Number.isFinite(sLat) ? sLat : null,
        lng: Number.isFinite(sLng) ? sLng : null,
        distanceKm: Number.isFinite(sLat) && Number.isFinite(sLng)
          ? Number(haversineDistanceKm(lat, lng, sLat, sLng).toFixed(1))
          : null,
        price: Number(price.toFixed(3)),
        source: "favorites"
      });
    }

    rows.sort((a, b) => a.price - b.price);
    res.json({
      fuelType: requestedFuelType,
      petrolVariant,
      lat,
      lng,
      radius,
      scope: "favorites",
      stations: rows.slice(0, limit)
    });
    return;
  }

  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    rad: String(radius),
    sort: "price",
    type: tankerType,
    apikey: TANKERKOENIG_API_KEY
  });
  const url = `https://creativecommons.tankerkoenig.de/json/list.php?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (!response.ok) {
      throw httpError(502, `Upstream HTTP ${response.status}`);
    }
    const payload = await response.json();
    const stations = Array.isArray(payload?.stations) ? payload.stations : [];
    const cleaned = stations
      .filter((station) => station && station.isOpen !== false)
      .map((station) => {
        const price = Number(station.price);
        return {
          id: station.id,
          name: station.name || "",
          brand: station.brand || "",
          street: station.street || "",
          place: station.place || "",
          lat: Number.isFinite(Number(station.lat)) ? Number(station.lat) : null,
          lng: Number.isFinite(Number(station.lng)) ? Number(station.lng) : null,
          distanceKm: Number.isFinite(station.dist) ? Number(station.dist.toFixed(1)) : null,
          price: Number.isFinite(price) && price > 0 ? Number(price.toFixed(3)) : null,
          source: "all"
        };
      })
      .filter((station) => Number.isFinite(station.price))
      .slice(0, limit);

    res.json({
      fuelType: requestedFuelType,
      petrolVariant,
      lat,
      lng,
      radius,
      scope: "all",
      stations: cleaned
    });
  } finally {
    clearTimeout(timeout);
  }
}));

app.get("/api/settings", asyncHandler(async (req, res) => {
  res.json(getGarageSettings(req.auth.garageId));
}));

app.put("/api/settings", asyncHandler(async (req, res) => {
  const saved = saveGarageSettings(req.auth.garageId, req.body || {});
  res.json(saved);
}));

app.get("/api/fuel-prices/insight", asyncHandler(async (req, res) => {
  const requestedFuelType = normalizeFuelType(req.query.fuelType || req.query.fuel || "DIESEL");
  const petrolVariant = normalizePetrolVariant(req.query.fuelVariant || "e5");
  const seriesFuelType = resolveFuelSeriesKey(requestedFuelType, petrolVariant);
  const scope = resolveScopeValue(req.query.scope || "favorites");
  const forceRefresh = ["1", "true", "yes"].includes(String(req.query.force || "").trim().toLowerCase());
  const now = new Date();
  const cacheKey = `${req.auth.garageId}:${seriesFuelType}:${scope}`;
  const cached = fuelInsightCache.get(cacheKey);
  if (!forceRefresh && cached && now.getTime() - cached.ts < PRICE_CACHE_TTL_MS) {
    res.json({
      ...cached.payload,
      cache: "hit"
    });
    return;
  }

  if (FUEL_PRICE_PROVIDER !== "tankerkoenig") {
    res.json({
      enabled: false,
      configured: false,
      reason: "Unsupported FUEL_PRICE_PROVIDER. Use tankerkoenig.",
      fuelType: requestedFuelType
    });
    return;
  }

  const garage = await prisma.garage.findUnique({
    where: { id: req.auth.garageId },
    select: { id: true, name: true }
  });
  const garageName = garage?.name || "Garage";
  const scoped = resolveStationIdsByScope(req.auth.garageId, garageName, scope);
  const stationIds = scoped.stationIds;
  const stationSource = scoped.stationSource;

  const buildPayloadFromHistory = async (historyEntries, currentSample, sampledAtIso, cacheTag = "miss") => {
    const series30d = buildDailyAvgSeries(
      historyEntries,
      req.auth.garageId,
      seriesFuelType,
      scope,
      now,
      PRICE_LOOKBACK_DAYS
    );
    const series180d = buildDailyAvgSeries(
      historyEntries,
      req.auth.garageId,
      seriesFuelType,
      scope,
      now,
      PRICE_HALF_YEAR_LOOKBACK_DAYS
    );
    const series7dHourly = buildHourlyAvgSeries(
      historyEntries,
      req.auth.garageId,
      seriesFuelType,
      scope,
      now,
      HOURLY_WINDOW_DAYS
    );
    const values30d = series30d.map((item) => item.price);
    const median30d = computeMedian(values30d);
    const average30d = computeAverage(values30d);
    const min30d = values30d.length ? Math.min(...values30d) : null;
    const max30d = values30d.length ? Math.max(...values30d) : null;
    const deltaToMedianPct = Number.isFinite(median30d) && median30d > 0
      ? ((currentSample.price - median30d) / median30d) * 100
      : null;
    const isCheapNow = Number.isFinite(deltaToMedianPct)
      ? deltaToMedianPct <= -CHEAP_THRESHOLD_PCT
      : false;
    const forecast = buildPriceForecast(series30d);
    const timingHint = buildTimingPattern(historyEntries, req.auth.garageId, seriesFuelType, scope, now);
    updatePricePatternStore(`${req.auth.garageId}|${seriesFuelType}|${scope}`, timingHint);

    const payload = {
      enabled: true,
      configured: true,
      available: true,
      provider: "tankerkoenig",
      fuelType: seriesFuelType,
      fuelBaseType: requestedFuelType,
      petrolVariant,
      sampledAt: sampledAtIso,
      current: {
        stationId: currentSample.stationId,
        stationName: (await fetchTankerkoenigStationName(currentSample.stationId))
          || currentSample.stationName
          || currentSample.stationId,
        price: Number(currentSample.price)
      },
      garageScope: {
        garageName,
        stationCount: stationIds.length,
        label: "Preise in deiner Garagen-Gegend",
        stationSource,
        selectedScope: scope
      },
      last30d: {
        sampleDays: series30d.length,
        median: median30d !== null ? Number(median30d.toFixed(3)) : null,
        average: average30d !== null ? Number(average30d.toFixed(3)) : null,
        min: min30d !== null ? Number(min30d.toFixed(3)) : null,
        max: max30d !== null ? Number(max30d.toFixed(3)) : null
      },
      cheapSignal: {
        thresholdPct: CHEAP_THRESHOLD_PCT,
        deltaToMedianPct: deltaToMedianPct !== null ? Number(deltaToMedianPct.toFixed(2)) : null,
        isCheapNow
      },
      forecast,
      timingHint,
      history30dDailyAvg: series30d,
      history180dDailyAvg: series180d,
      history7dHourly: series7dHourly
    };

    fuelInsightCache.set(cacheKey, {
      ts: now.getTime(),
      payload
    });

    return { ...payload, cache: cacheTag };
  };

  if (!TANKERKOENIG_API_KEY || stationIds.length === 0) {
    res.json({
      enabled: false,
      configured: false,
      reason: "Set TANKERKOENIG_API_KEY and station IDs (.env) for this garage.",
      fuelType: requestedFuelType
    });
    return;
  }

  const existingHistory = readPriceHistory();
  const latestSample = findLatestSample(existingHistory, req.auth.garageId, seriesFuelType, scope);
  const sampleAgeMs = latestSample ? now.getTime() - latestSample.ts : Number.POSITIVE_INFINITY;
  if (!forceRefresh && latestSample && sampleAgeMs < MIN_EXTERNAL_SAMPLE_INTERVAL_MS) {
    res.json(await buildPayloadFromHistory(existingHistory, latestSample, latestSample.timestamp, "history"));
    return;
  }

  let current;
  try {
    current = await fetchTankerkoenigCurrentPrice(seriesFuelType, stationIds);
  } catch (error) {
    res.json({
      enabled: true,
      configured: true,
      available: false,
      provider: "tankerkoenig",
      fuelType: requestedFuelType,
      reason: error.message || "Price lookup failed"
    });
    return;
  }

  if (!current) {
    res.json({
      enabled: true,
      configured: true,
      available: false,
      provider: "tankerkoenig",
      fuelType: requestedFuelType,
      reason: "No open station with a valid price in configured station list."
    });
    return;
  }

  if (current.unsupportedFuelType) {
    res.json({
      enabled: true,
      configured: true,
      available: false,
      provider: "tankerkoenig",
      fuelType: requestedFuelType,
      reason: "Fuel type is currently not supported for live price lookup."
    });
    return;
  }

  const historyWithSample = appendPriceSample(existingHistory, {
    timestamp: now.toISOString(),
    garageId: req.auth.garageId,
    fuelType: seriesFuelType,
    mode: scope,
    stationId: current.stationId,
    stationName: current.stationName,
    price: current.price
  });
  const nextHistory = compactPriceHistory(historyWithSample, now);
  writePriceHistory(nextHistory);
  res.json(await buildPayloadFromHistory(nextHistory, {
    stationId: current.stationId,
    stationName: current.stationName,
    price: current.price
  }, now.toISOString(), "miss"));
}));

app.get("/api/vehicles", asyncHandler(async (req, res) => {
  const vehicles = await prisma.vehicle.findMany({
    where: { garageId: req.auth.garageId },
    orderBy: { createdAt: "asc" }
  });

  res.json(vehicles);
}));

app.post("/api/vehicles", asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) {
    throw httpError(400, "name is required");
  }

  const vehicle = await prisma.vehicle.create({
    data: {
      garageId: req.auth.garageId,
      name,
      make: req.body.make ? String(req.body.make).trim() : null,
      model: req.body.model ? String(req.body.model).trim() : null,
      variant: req.body.variant ? String(req.body.variant).trim() : null,
      year: parseIntValue(req.body.year, "year"),
      plate: req.body.plate ? String(req.body.plate).trim() : null,
      fuelType: normalizeFuelType(req.body.fuelType),
      engineCode: req.body.engineCode ? String(req.body.engineCode).trim() : null,
      tireSize: req.body.tireSize ? String(req.body.tireSize).trim() : null,
      oilSpec: req.body.oilSpec ? String(req.body.oilSpec).trim() : null,
      notes: req.body.notes ? String(req.body.notes).trim() : null
    }
  });

  res.status(201).json(vehicle);
}));

app.get("/api/vehicles/:id", asyncHandler(async (req, res) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: req.params.id,
      garageId: req.auth.garageId
    }
  });

  if (!vehicle) {
    throw httpError(404, "Record not found");
  }

  res.json(vehicle);
}));

app.put("/api/vehicles/:id", asyncHandler(async (req, res) => {
  await loadRecordOr404(prisma.vehicle, req.auth.garageId, req.params.id);

  const data = {};
  if (req.body.name !== undefined) {
    const name = String(req.body.name || "").trim();
    if (!name) {
      throw httpError(400, "name cannot be empty");
    }
    data.name = name;
  }
  if (req.body.make !== undefined) data.make = req.body.make ? String(req.body.make).trim() : null;
  if (req.body.model !== undefined) data.model = req.body.model ? String(req.body.model).trim() : null;
  if (req.body.variant !== undefined) data.variant = req.body.variant ? String(req.body.variant).trim() : null;
  if (req.body.year !== undefined) data.year = parseIntValue(req.body.year, "year");
  if (req.body.plate !== undefined) data.plate = req.body.plate ? String(req.body.plate).trim() : null;
  if (req.body.fuelType !== undefined) data.fuelType = normalizeFuelType(req.body.fuelType);
  if (req.body.engineCode !== undefined) data.engineCode = req.body.engineCode ? String(req.body.engineCode).trim() : null;
  if (req.body.tireSize !== undefined) data.tireSize = req.body.tireSize ? String(req.body.tireSize).trim() : null;
  if (req.body.oilSpec !== undefined) data.oilSpec = req.body.oilSpec ? String(req.body.oilSpec).trim() : null;
  if (req.body.notes !== undefined) data.notes = req.body.notes ? String(req.body.notes).trim() : null;

  const vehicle = await prisma.vehicle.update({
    where: { id: req.params.id },
    data
  });

  res.json(vehicle);
}));

app.delete("/api/vehicles/:id", asyncHandler(async (req, res) => {
  await loadRecordOr404(prisma.vehicle, req.auth.garageId, req.params.id);
  await prisma.vehicle.delete({
    where: { id: req.params.id }
  });
  res.status(204).send();
}));

app.get("/api/refuels", asyncHandler(async (req, res) => {
  const where = { garageId: req.auth.garageId };

  if (req.query.vehicleId) {
    const vehicleId = String(req.query.vehicleId);
    await requireVehicleAccess(req.auth.garageId, vehicleId);
    where.vehicleId = vehicleId;
  }

  const refuels = await prisma.refuel.findMany({
    where,
    orderBy: { date: "desc" },
    include: {
      vehicle: {
        select: {
          id: true,
          name: true,
          plate: true,
          fuelType: true
        }
      }
    }
  });

  res.json(refuels);
}));

app.post("/api/refuels", asyncHandler(async (req, res) => {
  const vehicleId = String(req.body.vehicleId || "").trim();
  if (!vehicleId) {
    throw httpError(400, "vehicleId is required");
  }

  await requireVehicleAccess(req.auth.garageId, vehicleId);

  const refuel = await prisma.refuel.create({
    data: {
      garageId: req.auth.garageId,
      vehicleId,
      date: parseDateValue(req.body.date, "date", true),
      liters: parseDecimalValue(req.body.liters, "liters", 2, true),
      totalCost: parseDecimalValue(req.body.totalCost, "totalCost", 2, true),
      pricePerLiter: parseDecimalValue(req.body.pricePerLiter, "pricePerLiter", 3),
      odometer: parseIntValue(req.body.odometer, "odometer"),
      isPartial: parseBooleanValue(req.body.isPartial, false),
      notes: req.body.notes ? String(req.body.notes).trim() : null
    }
  });

  res.status(201).json(refuel);
}));

app.get("/api/refuels/:id", asyncHandler(async (req, res) => {
  const refuel = await prisma.refuel.findFirst({
    where: {
      id: req.params.id,
      garageId: req.auth.garageId
    },
    include: {
      vehicle: {
        select: {
          id: true,
          name: true,
          plate: true,
          fuelType: true
        }
      }
    }
  });

  if (!refuel) {
    throw httpError(404, "Record not found");
  }

  res.json(refuel);
}));

app.put("/api/refuels/:id", asyncHandler(async (req, res) => {
  await loadRecordOr404(prisma.refuel, req.auth.garageId, req.params.id);

  const data = {};
  if (req.body.vehicleId !== undefined) {
    const vehicleId = String(req.body.vehicleId || "").trim();
    if (!vehicleId) {
      throw httpError(400, "vehicleId cannot be empty");
    }
    await requireVehicleAccess(req.auth.garageId, vehicleId);
    data.vehicleId = vehicleId;
  }
  if (req.body.date !== undefined) data.date = parseDateValue(req.body.date, "date", true);
  if (req.body.liters !== undefined) data.liters = parseDecimalValue(req.body.liters, "liters", 2, true);
  if (req.body.totalCost !== undefined) data.totalCost = parseDecimalValue(req.body.totalCost, "totalCost", 2, true);
  if (req.body.pricePerLiter !== undefined) data.pricePerLiter = parseDecimalValue(req.body.pricePerLiter, "pricePerLiter", 3);
  if (req.body.odometer !== undefined) data.odometer = parseIntValue(req.body.odometer, "odometer");
  if (req.body.isPartial !== undefined) data.isPartial = parseBooleanValue(req.body.isPartial, false);
  if (req.body.notes !== undefined) data.notes = req.body.notes ? String(req.body.notes).trim() : null;

  const refuel = await prisma.refuel.update({
    where: { id: req.params.id },
    data
  });

  res.json(refuel);
}));

app.delete("/api/refuels/:id", asyncHandler(async (req, res) => {
  await loadRecordOr404(prisma.refuel, req.auth.garageId, req.params.id);
  await prisma.refuel.delete({
    where: { id: req.params.id }
  });
  res.status(204).send();
}));

app.get("/api/maintenance", asyncHandler(async (req, res) => {
  const where = { garageId: req.auth.garageId };

  if (req.query.vehicleId) {
    const vehicleId = String(req.query.vehicleId);
    await requireVehicleAccess(req.auth.garageId, vehicleId);
    where.vehicleId = vehicleId;
  }

  const items = await prisma.maintenance.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    include: {
      vehicle: {
        select: {
          id: true,
          name: true,
          plate: true
        }
      }
    }
  });

  res.json(items);
}));

app.post("/api/maintenance", asyncHandler(async (req, res) => {
  const vehicleId = String(req.body.vehicleId || "").trim();
  const title = String(req.body.title || "").trim();

  if (!vehicleId) {
    throw httpError(400, "vehicleId is required");
  }
  if (!title) {
    throw httpError(400, "title is required");
  }

  await requireVehicleAccess(req.auth.garageId, vehicleId);

  const item = await prisma.maintenance.create({
    data: {
      garageId: req.auth.garageId,
      vehicleId,
      title,
      performedAt: parseDateValue(req.body.performedAt, "performedAt"),
      dueDate: parseDateValue(req.body.dueDate, "dueDate"),
      dueKm: parseIntValue(req.body.dueKm, "dueKm"),
      remindDays: parseIntValue(req.body.remindDays, "remindDays"),
      remindKm: parseIntValue(req.body.remindKm, "remindKm"),
      odometer: parseIntValue(req.body.odometer, "odometer"),
      cost: parseDecimalValue(req.body.cost, "cost", 2),
      notes: req.body.notes ? String(req.body.notes).trim() : null
    }
  });

  res.status(201).json(item);
}));

app.get("/api/maintenance/:id", asyncHandler(async (req, res) => {
  const item = await prisma.maintenance.findFirst({
    where: {
      id: req.params.id,
      garageId: req.auth.garageId
    },
    include: {
      vehicle: {
        select: {
          id: true,
          name: true,
          plate: true
        }
      }
    }
  });

  if (!item) {
    throw httpError(404, "Record not found");
  }

  res.json(item);
}));

app.put("/api/maintenance/:id", asyncHandler(async (req, res) => {
  await loadRecordOr404(prisma.maintenance, req.auth.garageId, req.params.id);

  const data = {};
  if (req.body.vehicleId !== undefined) {
    const vehicleId = String(req.body.vehicleId || "").trim();
    if (!vehicleId) {
      throw httpError(400, "vehicleId cannot be empty");
    }
    await requireVehicleAccess(req.auth.garageId, vehicleId);
    data.vehicleId = vehicleId;
  }
  if (req.body.title !== undefined) {
    const title = String(req.body.title || "").trim();
    if (!title) {
      throw httpError(400, "title cannot be empty");
    }
    data.title = title;
  }
  if (req.body.performedAt !== undefined) data.performedAt = parseDateValue(req.body.performedAt, "performedAt");
  if (req.body.dueDate !== undefined) data.dueDate = parseDateValue(req.body.dueDate, "dueDate");
  if (req.body.dueKm !== undefined) data.dueKm = parseIntValue(req.body.dueKm, "dueKm");
  if (req.body.remindDays !== undefined) data.remindDays = parseIntValue(req.body.remindDays, "remindDays");
  if (req.body.remindKm !== undefined) data.remindKm = parseIntValue(req.body.remindKm, "remindKm");
  if (req.body.odometer !== undefined) data.odometer = parseIntValue(req.body.odometer, "odometer");
  if (req.body.cost !== undefined) data.cost = parseDecimalValue(req.body.cost, "cost", 2);
  if (req.body.notes !== undefined) data.notes = req.body.notes ? String(req.body.notes).trim() : null;

  const item = await prisma.maintenance.update({
    where: { id: req.params.id },
    data
  });

  res.json(item);
}));

app.delete("/api/maintenance/:id", asyncHandler(async (req, res) => {
  await loadRecordOr404(prisma.maintenance, req.auth.garageId, req.params.id);
  await prisma.maintenance.delete({
    where: { id: req.params.id }
  });
  res.status(204).send();
}));

app.get("/api/costs", asyncHandler(async (req, res) => {
  const where = { garageId: req.auth.garageId };

  if (req.query.vehicleId) {
    const vehicleId = String(req.query.vehicleId);
    await requireVehicleAccess(req.auth.garageId, vehicleId);
    where.vehicleId = vehicleId;
  }

  const costs = await prisma.cost.findMany({
    where,
    orderBy: { date: "desc" },
    include: {
      vehicle: {
        select: {
          id: true,
          name: true,
          plate: true
        }
      }
    }
  });

  res.json(costs);
}));

app.post("/api/costs", asyncHandler(async (req, res) => {
  const vehicleId = String(req.body.vehicleId || "").trim();
  const category = String(req.body.category || "").trim();

  if (!vehicleId) {
    throw httpError(400, "vehicleId is required");
  }
  if (!category) {
    throw httpError(400, "category is required");
  }

  await requireVehicleAccess(req.auth.garageId, vehicleId);

  const cost = await prisma.cost.create({
    data: {
      garageId: req.auth.garageId,
      vehicleId,
      date: parseDateValue(req.body.date, "date", true),
      category,
      amount: parseDecimalValue(req.body.amount, "amount", 2, true),
      odometer: parseIntValue(req.body.odometer, "odometer"),
      notes: req.body.notes ? String(req.body.notes).trim() : null
    }
  });

  res.status(201).json(cost);
}));

app.get("/api/costs/:id", asyncHandler(async (req, res) => {
  const cost = await prisma.cost.findFirst({
    where: {
      id: req.params.id,
      garageId: req.auth.garageId
    },
    include: {
      vehicle: {
        select: {
          id: true,
          name: true,
          plate: true
        }
      }
    }
  });

  if (!cost) {
    throw httpError(404, "Record not found");
  }

  res.json(cost);
}));

app.put("/api/costs/:id", asyncHandler(async (req, res) => {
  await loadRecordOr404(prisma.cost, req.auth.garageId, req.params.id);

  const data = {};
  if (req.body.vehicleId !== undefined) {
    const vehicleId = String(req.body.vehicleId || "").trim();
    if (!vehicleId) {
      throw httpError(400, "vehicleId cannot be empty");
    }
    await requireVehicleAccess(req.auth.garageId, vehicleId);
    data.vehicleId = vehicleId;
  }
  if (req.body.date !== undefined) data.date = parseDateValue(req.body.date, "date", true);
  if (req.body.category !== undefined) {
    const category = String(req.body.category || "").trim();
    if (!category) {
      throw httpError(400, "category cannot be empty");
    }
    data.category = category;
  }
  if (req.body.amount !== undefined) data.amount = parseDecimalValue(req.body.amount, "amount", 2, true);
  if (req.body.odometer !== undefined) data.odometer = parseIntValue(req.body.odometer, "odometer");
  if (req.body.notes !== undefined) data.notes = req.body.notes ? String(req.body.notes).trim() : null;

  const cost = await prisma.cost.update({
    where: { id: req.params.id },
    data
  });

  res.json(cost);
}));

app.delete("/api/costs/:id", asyncHandler(async (req, res) => {
  await loadRecordOr404(prisma.cost, req.auth.garageId, req.params.id);
  await prisma.cost.delete({
    where: { id: req.params.id }
  });
  res.status(204).send();
}));

app.use((error, _req, res, _next) => {
  if (error.code === "P2003") {
    res.status(409).json({
      error: "Record cannot be deleted because dependent data still exists"
    });
    return;
  }

  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    error: error.message || "Internal server error"
  });
});

// ── Auto-dump ─────────────────────────────────────────────────────────────────
const DUMP_PATH = "/data/dump.json";
const DUMP_INTERVAL_MS = 24 * 60 * 60 * 1000; // täglich

async function runDump() {
  try {
    const [vehicles, refuels, maintenances, costs] = await Promise.all([
      prisma.vehicle.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.refuel.findMany({ orderBy: { date: "asc" } }),
      prisma.maintenance.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.cost.findMany({ orderBy: { date: "asc" } })
    ]);
    const toDate = v => v ? new Date(v).toISOString().slice(0, 10) : null;
    const docs = [
      ...vehicles.map(v => ({ _id: v.id, type: "vehicle", name: v.name, make: v.make || "", model: v.model || "", variant: v.variant || "", year: v.year || null, plate: v.plate || "", fuelType: v.fuelType, engineCode: v.engineCode || "", tireSize: v.tireSize || "", oilSpec: v.oilSpec || "", notes: v.notes || "", createdAt: v.createdAt, updatedAt: v.updatedAt })),
      ...refuels.map(r => ({ _id: r.id, type: "fuel", vehicleId: r.vehicleId, date: toDate(r.date), liters: Number(r.liters), totalCost: Number(r.totalCost), pricePerLiter: r.pricePerLiter != null ? Number(r.pricePerLiter) : null, odometer: r.odometer || null, isPartial: r.isPartial, notes: r.notes || "", createdAt: r.createdAt, updatedAt: r.updatedAt })),
      ...maintenances.map(m => ({ _id: m.id, type: "maintenance", vehicleId: m.vehicleId, title: m.title, date: toDate(m.performedAt), dueDate: toDate(m.dueDate), dueKm: m.dueKm || null, reminderDaysBefore: m.remindDays || null, reminderKmBefore: m.remindKm || null, odometer: m.odometer || null, cost: m.cost != null ? Number(m.cost) : null, notes: m.notes || "", createdAt: m.createdAt, updatedAt: m.updatedAt })),
      ...costs.map(c => ({ _id: c.id, type: "cost", vehicleId: c.vehicleId, date: toDate(c.date), category: c.category, amount: Number(c.amount), odometer: c.odometer || null, notes: c.notes || "", createdAt: c.createdAt, updatedAt: c.updatedAt }))
    ];
    fs.mkdirSync(path.dirname(DUMP_PATH), { recursive: true });
    fs.writeFileSync(DUMP_PATH, JSON.stringify(docs, null, 2) + "\n");
    console.log(`[dump] ${vehicles.length} vehicles, ${refuels.length} refuels, ${maintenances.length} maintenances, ${costs.length} costs → ${DUMP_PATH}`);
  } catch (err) {
    console.error("[dump] failed:", err.message);
  }
}

app.listen(PORT, () => {
  console.log(`TankLog backend listening on port ${PORT}`);
  runDump();
  setInterval(runDump, DUMP_INTERVAL_MS);
  if (ENABLE_BACKGROUND_SNAPSHOTS) {
    runPriceSnapshotJob();
    setInterval(runPriceSnapshotJob, PRICE_SNAPSHOT_INTERVAL_MS);
  } else {
    console.log("[price-snapshot] disabled (set FUEL_PRICE_BACKGROUND_SNAPSHOTS=true to enable)");
  }
});
