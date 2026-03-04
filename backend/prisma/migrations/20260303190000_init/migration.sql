CREATE TYPE "FuelType" AS ENUM (
  'PETROL',
  'DIESEL',
  'HYBRID_PETROL',
  'HYBRID_DIESEL',
  'ELECTRIC',
  'LPG',
  'CNG',
  'OTHER'
);

CREATE TABLE "Garage" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Garage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "tokenVersion" INTEGER NOT NULL DEFAULT 0,
  "garageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Vehicle" (
  "id" TEXT NOT NULL,
  "garageId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "make" TEXT,
  "model" TEXT,
  "variant" TEXT,
  "year" INTEGER,
  "plate" TEXT,
  "fuelType" "FuelType" NOT NULL DEFAULT 'OTHER',
  "engineCode" TEXT,
  "tireSize" TEXT,
  "oilSpec" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Refuel" (
  "id" TEXT NOT NULL,
  "garageId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "liters" DECIMAL(10,2) NOT NULL,
  "totalCost" DECIMAL(10,2) NOT NULL,
  "pricePerLiter" DECIMAL(10,3),
  "odometer" INTEGER,
  "isPartial" BOOLEAN NOT NULL DEFAULT FALSE,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Refuel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Maintenance" (
  "id" TEXT NOT NULL,
  "garageId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "performedAt" TIMESTAMP(3),
  "dueDate" TIMESTAMP(3),
  "dueKm" INTEGER,
  "remindDays" INTEGER,
  "remindKm" INTEGER,
  "odometer" INTEGER,
  "cost" DECIMAL(10,2),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Maintenance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Cost" (
  "id" TEXT NOT NULL,
  "garageId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "category" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "odometer" INTEGER,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Cost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_garageId_idx" ON "User"("garageId");
CREATE INDEX "Vehicle_garageId_idx" ON "Vehicle"("garageId");
CREATE INDEX "Refuel_garageId_idx" ON "Refuel"("garageId");
CREATE INDEX "Refuel_vehicleId_idx" ON "Refuel"("vehicleId");
CREATE INDEX "Maintenance_garageId_idx" ON "Maintenance"("garageId");
CREATE INDEX "Maintenance_vehicleId_idx" ON "Maintenance"("vehicleId");
CREATE INDEX "Cost_garageId_idx" ON "Cost"("garageId");
CREATE INDEX "Cost_vehicleId_idx" ON "Cost"("vehicleId");

ALTER TABLE "User"
  ADD CONSTRAINT "User_garageId_fkey"
  FOREIGN KEY ("garageId") REFERENCES "Garage"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Vehicle"
  ADD CONSTRAINT "Vehicle_garageId_fkey"
  FOREIGN KEY ("garageId") REFERENCES "Garage"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Refuel"
  ADD CONSTRAINT "Refuel_garageId_fkey"
  FOREIGN KEY ("garageId") REFERENCES "Garage"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Refuel"
  ADD CONSTRAINT "Refuel_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Maintenance"
  ADD CONSTRAINT "Maintenance_garageId_fkey"
  FOREIGN KEY ("garageId") REFERENCES "Garage"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Maintenance"
  ADD CONSTRAINT "Maintenance_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Cost"
  ADD CONSTRAINT "Cost_garageId_fkey"
  FOREIGN KEY ("garageId") REFERENCES "Garage"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Cost"
  ADD CONSTRAINT "Cost_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
