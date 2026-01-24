import { PrismaClient } from "@prisma/client";
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// Ensure a single PrismaClient instance across hot-reloads in dev
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}


export const connectDatabase = async () => {
  try {
    await prisma.$connect();
    console.log('✅ Connected to the database');
  } catch (error) {
    console.error('❌ Failed to connect to the database', error);
    process.exit(1);
  }
};

export const disconnectDatabase = async () => {
  try {
    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Failed to disconnect from the database', error);
    process.exit(1);
  }
};

export default prisma;