const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const conn = await prisma.twilioConnection.findFirst({ where: { userId: 7 } });
  console.log(conn);
}
main().catch(console.error).finally(() => prisma.$disconnect());
