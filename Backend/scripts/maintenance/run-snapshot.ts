import { snapshotService } from '../../src/services/snapshot.service';

async function main() {
    await snapshotService.captureDailySnapshots();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
