import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixSprintAssociations() {
    console.log('=== CORREÇÃO: ASSOCIAÇÕES DE SPRINTS ===\n');

    try {
        // 1. Buscar projeto correto "GIGA - Retrabalho"
        const retrabalhoProject = await prisma.project.findFirst({
            where: {
                name: {
                    contains: 'Retrabalho'
                }
            }
        });

        if (!retrabalhoProject) {
            console.log('❌ Projeto "GIGA - Retrabalho" não encontrado');
            return;
        }

        console.log('✅ Projeto "GIGA - Retrabalho" encontrado:');
        console.log(`   ID: ${retrabalhoProject.id}`);
        console.log(`   Nome: ${retrabalhoProject.name}\n`);

        // 2. Buscar todas as sprints com path "GIGA - Retrabalho" mas projectId diferente
        const incorrectSprints = await prisma.sprint.findMany({
            where: {
                path: {
                    startsWith: 'GIGA - Retrabalho'
                },
                projectId: {
                    not: retrabalhoProject.id
                }
            },
            include: {
                project: {
                    select: { name: true }
                }
            }
        });

        console.log(`🔍 Sprints com associação incorreta: ${incorrectSprints.length}\n`);

        if (incorrectSprints.length === 0) {
            console.log('✅ Nenhuma sprint precisa de correção');
            return;
        }

        // 3. Mostrar sprints que serão corrigidas
        console.log('📋 Sprints que serão corrigidas:\n');
        incorrectSprints.forEach(sprint => {
            console.log(`   - ${sprint.name}`);
            console.log(`     Path: ${sprint.path}`);
            console.log(`     Projeto atual (ERRADO): ${sprint.project.name}`);
            console.log(`     Projeto correto: ${retrabalhoProject.name}`);
            console.log('');
        });

        // 4. Confirmar e executar correção
        console.log('🔧 Executando correção...\n');

        const result = await prisma.sprint.updateMany({
            where: {
                path: {
                    startsWith: 'GIGA - Retrabalho'
                },
                projectId: {
                    not: retrabalhoProject.id
                }
            },
            data: {
                projectId: retrabalhoProject.id
            }
        });

        console.log(`✅ SUCESSO: ${result.count} sprints corrigidas!\n`);

        // 5. Verificar resultado
        console.log('🔍 Verificando correção...\n');

        const verifyIncorrect = await prisma.sprint.findMany({
            where: {
                path: {
                    startsWith: 'GIGA - Retrabalho'
                },
                projectId: {
                    not: retrabalhoProject.id
                }
            }
        });

        if (verifyIncorrect.length === 0) {
            console.log('✅ VERIFICAÇÃO PASSOU: Todas as sprints do Retrabalho estão corretas');
        } else {
            console.log(`⚠️  Ainda existem ${verifyIncorrect.length} sprints incorretas`);
        }

        // 6. Mostrar sprints do Retrabalho após correção
        console.log('\n📊 Sprints do projeto "GIGA - Retrabalho" após correção:\n');

        const retrabalhoSprints = await prisma.sprint.findMany({
            where: {
                projectId: retrabalhoProject.id
            },
            orderBy: {
                startDate: 'desc'
            }
        });

        retrabalhoSprints.forEach(sprint => {
            const emoji = sprint.state === 'Active' ? '🟢' : sprint.state === 'Past' ? '🔴' : '🟡';
            console.log(`   ${emoji} ${sprint.name} (${sprint.state})`);
        });

        console.log(`\n   Total: ${retrabalhoSprints.length} sprints\n`);

        // 7. Verificar sprint ativa
        const activeSprint = retrabalhoSprints.find(s => s.state === 'Active');
        if (activeSprint) {
            console.log('✅ Sprint ativa encontrada:');
            console.log(`   Nome: ${activeSprint.name}`);
            console.log(`   Período: ${activeSprint.startDate.toISOString().split('T')[0]} → ${activeSprint.endDate.toISOString().split('T')[0]}`);

            // Verificar capacidades
            const capacities = await prisma.teamCapacity.count({
                where: {
                    sprintId: activeSprint.id
                }
            });

            console.log(`   Capacidades: ${capacities} membros`);
        } else {
            console.log('⚠️  Nenhuma sprint ativa encontrada');
        }

    } catch (error) {
        console.error('❌ Erro durante correção:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

fixSprintAssociations()
    .catch(e => {
        console.error('Erro fatal:', e);
        process.exit(1);
    });
