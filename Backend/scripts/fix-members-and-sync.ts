import { PrismaClient } from '@prisma/client';
import { getAzureDevOpsClient } from '../src/integrations/azure/client';
import { logger } from '../src/utils/logger';

const prisma = new PrismaClient();

async function fixMembersAndSyncCapacity() {
    console.log('=== CORREÇÃO: MEMBROS E CAPACIDADES ===\n');

    try {
        // 1. Buscar Sprint 5 e projeto
        const sprint5 = await prisma.sprint.findFirst({
            where: {
                name: 'Sprint 5',
                path: { startsWith: 'GIGA - Retrabalho' }
            },
            include: { project: true }
        });

        if (!sprint5) {
            console.log('❌ Sprint 5 não encontrada');
            return;
        }

        console.log('✅ Sprint 5 encontrada:');
        console.log(`   Projeto: ${sprint5.project.name}`);
        console.log(`   Azure ID: ${sprint5.azureId}\n`);

        // 2. Buscar capacidades do Azure DevOps
        console.log('🔄 Buscando capacidades do Azure DevOps...\n');

        const client = getAzureDevOpsClient();
        const workApi = await client.getWorkApi();
        const coreApi = await client.getCoreApi();

        const teams = await coreApi.getTeams(sprint5.project.azureId);
        if (teams.length === 0) {
            console.log('❌ Nenhum team encontrado');
            return;
        }

        const team = teams[0];
        const teamContext = {
            project: sprint5.project.name,
            projectId: sprint5.project.azureId,
            team: team.name,
            teamId: team.id
        };

        const api: any = workApi;
        const capacityData = await api.getCapacitiesWithIdentityRefAndTotals(teamContext, sprint5.azureId);

        if (!capacityData || !capacityData.teamMembers) {
            console.log('❌ Nenhuma capacidade encontrada no Azure DevOps');
            return;
        }

        console.log(`✅ Encontrados ${capacityData.teamMembers.length} membros com capacidade\n`);

        // 3. Para cada membro, verificar se já existe e reassociar se necessário
        console.log('🔧 Processando membros...\n');

        for (const cap of capacityData.teamMembers) {
            if (!cap.teamMember || !cap.teamMember.id) continue;

            const azureMember = cap.teamMember;
            console.log(`Processando: ${azureMember.displayName}`);

            // Verificar se membro já existe (em qualquer projeto)
            const existingMember = await prisma.teamMember.findFirst({
                where: {
                    azureId: azureMember.id
                }
            });

            let member;

            if (existingMember) {
                // Membro existe - verificar se está no projeto correto
                if (existingMember.projectId !== sprint5.projectId) {
                    console.log(`   ⚠️  Membro existe em outro projeto, reassociando...`);

                    // Opção 1: Atualizar projeto do membro existente
                    // PROBLEMA: Pode quebrar capacidades de outras sprints

                    // Opção 2: Criar novo registro para este projeto
                    // PROBLEMA: Viola constraint unique(azureId, projectId)

                    // Opção 3: Usar o membro existente e criar capacidade
                    // MELHOR: Capacidades podem ter membros de outros projetos

                    console.log(`   ℹ️  Usando membro existente (ID: ${existingMember.id})`);
                    member = existingMember;
                } else {
                    console.log(`   ✅ Membro já está no projeto correto`);
                    member = existingMember;
                }
            } else {
                // Membro não existe - criar
                console.log(`   ➕ Criando novo membro`);
                member = await prisma.teamMember.create({
                    data: {
                        azureId: azureMember.id,
                        displayName: azureMember.displayName,
                        uniqueName: azureMember.uniqueName || azureMember.displayName,
                        imageUrl: azureMember.imageUrl,
                        projectId: sprint5.projectId
                    }
                });
            }

            // 4. Calcular capacidade
            const capacityPerDay = cap.activities.reduce((acc: number, act: any) =>
                acc + (act.capacityPerDay || 0), 0) || 0;

            const sprintStart = new Date(sprint5.startDate);
            const sprintEnd = new Date(sprint5.endDate);

            // Calcular dias úteis
            let businessDays = 0;
            const curDate = new Date(sprintStart);
            while (curDate <= sprintEnd) {
                const dayOfWeek = curDate.getUTCDay();
                if (dayOfWeek !== 0 && dayOfWeek !== 6) businessDays++;
                curDate.setUTCDate(curDate.getUTCDate() + 1);
            }

            // Team days off (simplificado - assumir 3 dias conforme log anterior)
            const teamDaysOff = 3;
            const netDays = businessDays - teamDaysOff;

            // Individual days off
            let individualDaysOff = 0;
            if (cap.daysOff) {
                for (const d of cap.daysOff) {
                    const start = new Date(d.start);
                    const end = new Date(d.end);
                    for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
                        if (dt >= sprintStart && dt <= sprintEnd) {
                            const dayOfWeek = dt.getUTCDay();
                            if (dayOfWeek !== 0 && dayOfWeek !== 6) individualDaysOff++;
                        }
                    }
                }
            }

            const availableDays = Math.max(0, netDays - individualDaysOff);
            const totalHours = capacityPerDay * netDays;
            const availableHours = capacityPerDay * availableDays;

            // 5. Criar ou atualizar capacidade
            await prisma.teamCapacity.upsert({
                where: {
                    memberId_sprintId: {
                        memberId: member.id,
                        sprintId: sprint5.id
                    }
                },
                create: {
                    memberId: member.id,
                    sprintId: sprint5.id,
                    totalHours,
                    availableHours,
                    allocatedHours: 0,
                    daysOff: cap.daysOff || [],
                    activitiesPerDay: cap.activities || []
                },
                update: {
                    totalHours,
                    availableHours,
                    daysOff: cap.daysOff || [],
                    activitiesPerDay: cap.activities || []
                }
            });

            console.log(`   ✅ Capacidade sincronizada: ${availableHours}h disponíveis\n`);
        }

        // 6. Verificar resultado final
        console.log('\n📊 RESULTADO FINAL:\n');

        const finalCapacities = await prisma.teamCapacity.findMany({
            where: { sprintId: sprint5.id },
            include: { member: true }
        });

        console.log(`Total de capacidades: ${finalCapacities.length}\n`);

        finalCapacities.forEach(cap => {
            console.log(`✅ ${cap.member.displayName}`);
            console.log(`   Disponível: ${cap.availableHours}h`);
        });

        const totalAvailable = finalCapacities.reduce((sum, cap) => sum + cap.availableHours, 0);
        console.log(`\n📈 Total disponível: ${totalAvailable}h`);

    } catch (error) {
        console.error('❌ Erro:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

fixMembersAndSyncCapacity()
    .catch(e => {
        console.error('Erro fatal:', e);
        process.exit(1);
    });
