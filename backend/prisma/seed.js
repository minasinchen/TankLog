require("dotenv").config();

const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
function normalizeUserId(value, fieldPath) {
  const userId = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!userId) {
    throw new Error(`${fieldPath} must be a non-empty string`);
  }
  return userId;
}

function parseMultiGarageSeed() {
  const raw = process.env.SEED_GARAGES;
  if (!raw || !raw.trim()) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("SEED_GARAGES must be valid JSON");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("SEED_GARAGES must be a non-empty JSON array");
  }

  const seenUsers = new Set();
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`SEED_GARAGES[${index}] must be an object`);
    }

    const garageName = typeof item.name === "string" ? item.name.trim() : "";
    if (!garageName) {
      throw new Error(`SEED_GARAGES[${index}].name is required`);
    }

    if (!Array.isArray(item.users) || item.users.length === 0) {
      throw new Error(`SEED_GARAGES[${index}].users must be a non-empty array`);
    }

    const users = item.users.map((userId, userIndex) => {
      const normalized = normalizeUserId(userId, `SEED_GARAGES[${index}].users[${userIndex}]`);

      if (seenUsers.has(normalized)) {
        throw new Error(`Duplicate user id in SEED_GARAGES: ${normalized}`);
      }
      seenUsers.add(normalized);

      return normalized;
    });

    return {
      name: garageName,
      users,
      password: item.password === undefined ? null : String(item.password)
    };
  });
}

function parseLegacySeed() {
  const garageName = process.env.SEED_GARAGE_NAME || "Haushalt";
  const user1Email = normalizeUserId(process.env.SEED_USER1_EMAIL || "ich", "SEED_USER1_EMAIL");
  const user2Email = normalizeUserId(process.env.SEED_USER2_EMAIL || "partner", "SEED_USER2_EMAIL");

  return [
    {
      name: garageName,
      users: [user1Email, user2Email]
    }
  ];
}

async function main() {
  const defaultSeedPassword = process.env.SEED_PASSWORD || "Test1234!";
  const seedGarages = parseMultiGarageSeed() || parseLegacySeed();
  let seededUsers = 0;

  for (const seedGarage of seedGarages) {
    const garagePassword = seedGarage.password === null
      ? defaultSeedPassword
      : String(seedGarage.password || "").trim();
    if (!garagePassword) {
      throw new Error(`Password missing for garage "${seedGarage.name}"`);
    }
    const passwordHash = await bcrypt.hash(garagePassword, 12);

    let garage = await prisma.garage.findFirst({
      where: { name: seedGarage.name }
    });

    if (!garage) {
      garage = await prisma.garage.create({
        data: { name: seedGarage.name }
      });
    }

    for (const email of seedGarage.users) {
      await prisma.user.upsert({
        where: { email },
        update: {
          passwordHash,
          garageId: garage.id
        },
        create: {
          email,
          passwordHash,
          garageId: garage.id
        }
      });
      seededUsers += 1;
    }
  }

  console.log(`Seed complete: ${seedGarages.length} garage(s), ${seededUsers} user(s).`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Seed failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
