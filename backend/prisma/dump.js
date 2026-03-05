require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const OUTPUT = path.resolve(__dirname, "../../data/dump.json");

function toDateOnly(value) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

async function main() {
  const [vehicles, refuels, maintenances, costs] = await Promise.all([
    prisma.vehicle.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.refuel.findMany({ orderBy: { date: "asc" } }),
    prisma.maintenance.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.cost.findMany({ orderBy: { date: "asc" } })
  ]);

  const docs = [
    ...vehicles.map((v) => ({
      _id: v.id,
      type: "vehicle",
      name: v.name,
      make: v.make || "",
      model: v.model || "",
      variant: v.variant || "",
      year: v.year || null,
      plate: v.plate || "",
      fuelType: v.fuelType,
      engineCode: v.engineCode || "",
      tireSize: v.tireSize || "",
      oilSpec: v.oilSpec || "",
      notes: v.notes || "",
      createdAt: v.createdAt,
      updatedAt: v.updatedAt
    })),
    ...refuels.map((r) => ({
      _id: r.id,
      type: "fuel",
      vehicleId: r.vehicleId,
      date: toDateOnly(r.date),
      liters: Number(r.liters),
      totalCost: Number(r.totalCost),
      pricePerLiter: r.pricePerLiter != null ? Number(r.pricePerLiter) : null,
      odometer: r.odometer || null,
      isPartial: r.isPartial,
      notes: r.notes || "",
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    })),
    ...maintenances.map((m) => ({
      _id: m.id,
      type: "maintenance",
      vehicleId: m.vehicleId,
      title: m.title,
      date: toDateOnly(m.performedAt),
      dueDate: toDateOnly(m.dueDate),
      dueKm: m.dueKm || null,
      reminderDaysBefore: m.remindDays || null,
      reminderKmBefore: m.remindKm || null,
      odometer: m.odometer || null,
      cost: m.cost != null ? Number(m.cost) : null,
      notes: m.notes || "",
      createdAt: m.createdAt,
      updatedAt: m.updatedAt
    })),
    ...costs.map((c) => ({
      _id: c.id,
      type: "cost",
      vehicleId: c.vehicleId,
      date: toDateOnly(c.date),
      category: c.category,
      amount: Number(c.amount),
      odometer: c.odometer || null,
      notes: c.notes || "",
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    }))
  ];

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(docs, null, 2) + "\n");

  console.log(
    `Exported ${vehicles.length} vehicles, ${refuels.length} refuels, ` +
    `${maintenances.length} maintenances, ${costs.length} costs → ${OUTPUT}`
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Dump failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
