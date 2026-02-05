import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetDatabase() {
  console.log('🗑️  Resetting database...');

  try {
    // Deletar todos os dados em ordem reversa de dependências
    await prisma.alert.deleteMany();
    await prisma.syncLog.deleteMany();
    await prisma.reportTemplate.deleteMany();
    await prisma.report.deleteMany();
    await prisma.metricSnapshot.deleteMany();
    await prisma.workItemComment.deleteMany();
    await prisma.workItemRevision.deleteMany();
    await prisma.workItem.deleteMany();
    await prisma.sprintSnapshot.deleteMany();
    await prisma.teamCapacity.deleteMany();
    await prisma.sprint.deleteMany();
    await prisma.teamMember.deleteMany();
    await prisma.project.deleteMany();
    await prisma.userPreference.deleteMany();

    console.log('✅ Database reset completed!');
  } catch (error) {
    console.error('❌ Reset failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

resetDatabase();
