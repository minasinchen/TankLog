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
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || !password) {
    throw httpError(400, "email and password are required");
  }

  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) {
    throw httpError(401, "Invalid credentials");
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    throw httpError(401, "Invalid credentials");
  }

  const token = signToken(user);

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
});
