import { PrismaClient } from '@prisma/client';
import { snapshotService } from '../src/services/snapshot.service.js';

const prisma = new PrismaClient();

async function createBaselineSnapshot() {
    console.log('=== CRIAR SNAPSHOT BASELINE PARA SPRINT 5 ===\n');

    // Buscar Sprint 5
    const sprint5 = await prisma.sprint.findFirst({
        where: {
            name: 'Sprint 5',
            path: { startsWith: 'GIGA - Retrabalho' }
        }
    });

    if (!sprint5) {
        console.log('❌ Sprint 5 não encontrada');
        return;
    }

    console.log(`Sprint: ${sprint5.name}`);
    console.log(`ID: ${sprint5.id}\n`);

    // Verificar se já existe snapshot
    const existingSnapshots = await prisma.sprintSnapshot.findMany({
        where: { sprintId: sprint5.id },
        orderBy: { snapshotDate: 'asc' }
    });

    console.log(`Snapshots existentes: ${existingSnapshots.length}\n`);

    if (existingSnapshots.length > 0) {
        console.log('Snapshots atuais:');
        existingSnapshots.forEach((s, idx) => {
            console.log(`   ${idx + 1}. ${s.snapshotDate.toISOString().split('T')[0]}`);
            console.log(`      Total Work: ${s.totalWork}h`);
            console.log(`      Remaining: ${s.remainingWork}h`);
            console.log(`      Completed: ${s.completedWork}h\n`);
        });
    }

    // Criar novo snapshot
    console.log('🔄 Criando snapshot...\n');

    try {
        await snapshotService.createSprintSnapshot(sprint5.id);
        console.log('✅ Snapshot criado com sucesso!\n');

        // Verificar snapshot criado
        const newSnapshots = await prisma.sprintSnapshot.findMany({
            where: { sprintId: sprint5.id },
            orderBy: { snapshotDate: 'desc' },
            take: 1
        });

        if (newSnapshots.length > 0) {
            const latest = newSnapshots[0];
            console.log('📊 Snapshot mais recente:');
            console.log(`   Data: ${latest.snapshotDate.toISOString()}`);
            console.log(`   Total Work: ${latest.totalWork}h`);
            console.log(`   Remaining Work: ${latest.remainingWork}h`);
            console.log(`   Completed Work: ${latest.completedWork}h`);
            console.log(`   Total Points: ${latest.totalPoints}`);
            console.log(`   Items: ${latest.todoCount + latest.inProgressCount + latest.doneCount}`);
        }
    } catch (error) {
        console.error('❌ Erro ao criar snapshot:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

createBaselineSnapshot()
    .catch(e => {
        console.error('Erro fatal:', e);
        process.exit(1);
    });
