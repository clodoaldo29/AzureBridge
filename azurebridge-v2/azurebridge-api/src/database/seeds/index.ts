import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Limpar dados existentes (apenas em desenvolvimento)
  if (process.env.NODE_ENV === 'development') {
    console.log('🗑️  Cleaning existing data...');

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
  }

  // ========================================
  // Templates de Relatórios
  // ========================================
  console.log('📄 Creating report templates...');

  await prisma.reportTemplate.create({
    data: {
      name: 'RDA Padrão Instituto',
      description: 'Template padrão para Relatório Demonstrativo Anual',
      type: 'rda',
      isDefault: true,
      isActive: true,
      version: 1,
      createdBy: 'system',
      structure: {
        sections: [
          {
            id: 'executive_summary',
            title: '1. RESUMO EXECUTIVO',
            order: 1,
            fields: ['totalSprints', 'completedPBIs', 'totalStoryPoints', 'totalHours'],
          },
          {
            id: 'sprints',
            title: '2. SPRINTS REALIZADAS',
            order: 2,
            fields: ['sprintList', 'sprintDetails', 'workItems'],
          },
          {
            id: 'metrics',
            title: '3. MÉTRICAS E INDICADORES',
            order: 3,
            fields: ['velocity', 'qualityMetrics', 'teamPerformance'],
          },
          {
            id: 'achievements',
            title: '4. ENTREGAS E REALIZAÇÕES',
            order: 4,
            fields: ['majorFeatures', 'bugsFixes', 'improvements'],
          },
        ],
        formatting: {
          pageSize: 'A4',
          margins: { top: 2, right: 2, bottom: 2, left: 2 },
          fontSize: 11,
          fontFamily: 'Arial',
        },
      },
      styles: {
        headerColor: '#1e40af',
        accentColor: '#3b82f6',
        textColor: '#1f2937',
      },
    },
  });

  await prisma.reportTemplate.create({
    data: {
      name: 'Sprint Report Padrão',
      description: 'Template para relatório de sprint',
      type: 'sprint_report',
      isDefault: true,
      isActive: true,
      version: 1,
      createdBy: 'system',
      structure: {
        sections: [
          {
            id: 'overview',
            title: 'Visão Geral da Sprint',
            order: 1,
            fields: ['sprintName', 'dates', 'teamMembers', 'commitment'],
          },
          {
            id: 'completion',
            title: 'Completude',
            order: 2,
            fields: ['completedPBIs', 'incompletePBIs', 'velocity', 'burndown'],
          },
          {
            id: 'quality',
            title: 'Qualidade',
            order: 3,
            fields: ['bugsFound', 'bugsFixed', 'testCoverage'],
          },
          {
            id: 'retrospective',
            title: 'Retrospectiva',
            order: 4,
            fields: ['wentWell', 'toImprove', 'actionItems'],
          },
        ],
      },
    },
  });

  console.log('✅ Created 2 report templates');

  console.log('✨ Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
