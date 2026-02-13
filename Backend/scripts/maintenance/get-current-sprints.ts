import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
const prisma = new PrismaClient();
async function main() {
    const sprints = await prisma.sprint.findMany({
        where: { state: { not: 'Past' } },
        select: { id: true, name: true, project: { select: { name: true } } },
    });
    for (const s of sprints) {
        console.log(`${s.id} | ${s.project?.name} / ${s.name}`);
    }
    await prisma.$disconnect();
}
main();
