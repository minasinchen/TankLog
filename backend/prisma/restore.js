require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const INPUT = path.resolve(__dirname, "../../data/dump.json");

const FUEL_TYPE_MAP = {
  PETROL: "PETROL",
  BENZIN: "PETROL",
  DIESEL: "DIESEL",
  HYBRID_PETROL: "HYBRID_PETROL",
  HYBRID_DIESEL: "HYBRID_DIESEL",
  ELECTRIC: "ELECTRIC",
  ELEKTRO: "ELECTRIC",
  LPG: "LPG",
  CNG: "CNG",
  OTHER: "OTHER",
  SONSTIGES: "OTHER"
};

function normalizeFuelType(value) {
  return FUEL_TYPE_MAP[String(value || "").trim().toUpperCase()] || "OTHER";
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    throw new Error(`Dump file not found: ${INPUT}`);
  }

  const docs = JSON.parse(fs.readFileSync(INPUT, "utf8"));

  // Resolve the target garage (first garage in DB, created if none exists)
  let garage = await prisma.garage.findFirst();
  if (!garage) {
    throw new Error(
      "No garage found. Run `npm run db:seed` first to create a garage and user."
    );
  }

  const garageId = garage.id;
  const vehicleIdMap = {};
  let counts = { vehicles: 0, refuels: 0, maintenances: 0, costs: 0 };

  // --- Vehicles ---
  for (const doc of docs.filter((d) => d.type === "vehicle")) {
    const existing = await prisma.vehicle.findFirst({
      where: { id: doc._id, garageId }
    });

    const data = {
      garageId,
      name: doc.name,
      make: doc.make || null,
      model: doc.model || null,
      variant: doc.variant || null,
      year: doc.year || null,
      plate: doc.plate || null,
      fuelType: normalizeFuelType(doc.fuelType),
      engineCode: doc.engineCode || null,
      tireSize: doc.tireSize || null,
      oilSpec: doc.oilSpec || null,
      notes: doc.notes || null
    };

    let vehicle;
    if (existing) {
      vehicle = await prisma.vehicle.update({ where: { id: doc._id }, data });
    } else {
      vehicle = await prisma.vehicle.create({ data: { id: doc._id, ...data } });
    }

    vehicleIdMap[doc._id] = vehicle.id;
    counts.vehicles += 1;
  }

  // --- Refuels ---
  for (const doc of docs.filter((d) => d.type === "fuel")) {
    const vehicleId = vehicleIdMap[doc.vehicleId];
    if (!vehicleId) {
      console.warn(`Skipping refuel ${doc._id}: vehicle ${doc.vehicleId} not found`);
      continue;
    }

    const data = {
      garageId,
      vehicleId,
      date: new Date(doc.date),
      liters: doc.liters,
      totalCost: doc.totalCost,
      pricePerLiter: doc.pricePerLiter ?? null,
      odometer: doc.odometer ?? null,
      isPartial: doc.isPartial ?? false,
      notes: doc.notes || null
    };

    const existing = await prisma.refuel.findFirst({ where: { id: doc._id } });
    if (existing) {
      await prisma.refuel.update({ where: { id: doc._id }, data });
    } else {
      await prisma.refuel.create({ data: { id: doc._id, ...data } });
    }
    counts.refuels += 1;
  }

  // --- Maintenances ---
  for (const doc of docs.filter((d) => d.type === "maintenance")) {
    const vehicleId = vehicleIdMap[doc.vehicleId];
    if (!vehicleId) {
      console.warn(`Skipping maintenance ${doc._id}: vehicle ${doc.vehicleId} not found`);
      continue;
    }

    const data = {
      garageId,
      vehicleId,
      title: doc.title,
      performedAt: doc.date ? new Date(doc.date) : null,
      dueDate: doc.dueDate ? new Date(doc.dueDate) : null,
      dueKm: doc.dueKm ?? null,
      remindDays: doc.reminderDaysBefore ?? null,
      remindKm: doc.reminderKmBefore ?? null,
      odometer: doc.odometer ?? null,
      cost: doc.cost ?? null,
      notes: doc.notes || null
    };

    const existing = await prisma.maintenance.findFirst({ where: { id: doc._id } });
    if (existing) {
      await prisma.maintenance.update({ where: { id: doc._id }, data });
    } else {
      await prisma.maintenance.create({ data: { id: doc._id, ...data } });
    }
    counts.maintenances += 1;
  }

  // --- Costs ---
  for (const doc of docs.filter((d) => d.type === "cost")) {
    const vehicleId = vehicleIdMap[doc.vehicleId];
    if (!vehicleId) {
      console.warn(`Skipping cost ${doc._id}: vehicle ${doc.vehicleId} not found`);
      continue;
    }

    const data = {
      garageId,
      vehicleId,
      date: new Date(doc.date),
      category: doc.category,
      amount: doc.amount,
      odometer: doc.odometer ?? null,
      notes: doc.notes || null
    };

    const existing = await prisma.cost.findFirst({ where: { id: doc._id } });
    if (existing) {
      await prisma.cost.update({ where: { id: doc._id }, data });
    } else {
      await prisma.cost.create({ data: { id: doc._id, ...data } });
    }
    counts.costs += 1;
  }

  console.log(
    `Restored ${counts.vehicles} vehicles, ${counts.refuels} refuels, ` +
    `${counts.maintenances} maintenances, ${counts.costs} costs → garage "${garage.name}"`
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Restore failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
