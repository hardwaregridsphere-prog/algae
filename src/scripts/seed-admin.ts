import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt'; // Change to 'bcryptjs' if that's what you installed

const prisma = new PrismaClient();

async function main() {
  // Hash the default password
  const password_hash = await bcrypt.hash('admin123', 10);

  // Create the Super Admin user
  const admin = await prisma.user.upsert({
    where: { email: 'admin@algaetree.com' },
    update: {},
    create: {
      email: 'admin@algaetree.com',
      password_hash,
      name: 'System Admin',
      role: 'SUPER_ADMIN',
    },
  });

  console.log(`✅ Admin created successfully!`);
  console.log(`Email: ${admin.email}`);
  console.log(`Password: admin123`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });