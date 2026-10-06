import 'dotenv/config'; // <-- Add this line to load your .env variables
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL || 'admin@algaetree.local';
  const password = process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe123!';
  const name = process.env.SUPER_ADMIN_NAME || 'Super Admin';

  const password_hash = await argon2.hash(password);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, password_hash, role: 'SUPER_ADMIN' },
  });

  console.log(`Seed complete. Super Admin created: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });