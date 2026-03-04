require("dotenv").config();

const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const garageName = process.env.SEED_GARAGE_NAME || "Haushalt";
  const user1Email = process.env.SEED_USER1_EMAIL || "ich@example.com";
  const user2Email = process.env.SEED_USER2_EMAIL || "partner@example.com";
  const seedPassword = process.env.SEED_PASSWORD || "Test1234!";

  let garage = await prisma.garage.findFirst({
    where: { name: garageName }
  });

  if (!garage) {
    garage = await prisma.garage.create({
      data: { name: garageName }
    });
  }

  const passwordHash = await bcrypt.hash(seedPassword, 12);

  for (const email of [user1Email, user2Email]) {
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
  }
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
