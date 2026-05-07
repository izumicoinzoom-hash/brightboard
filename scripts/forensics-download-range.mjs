// 指定された日付のバックアップをローカルにDL
import admin from 'firebase-admin';
import fs from 'node:fs';

admin.initializeApp({ projectId: 'brightboard-4595a', storageBucket: 'brightboard-4595a.firebasestorage.app' });
const bucket = admin.storage().bucket();

const dates = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05'];
fs.mkdirSync('/tmp/bb-forensics', { recursive: true });

for (const d of dates) {
  const remoteName = `backups/2026/05/brightboard-backup-${d}.json`;
  const localPath = `/tmp/bb-forensics/brightboard-backup-${d}.json`;
  if (fs.existsSync(localPath)) {
    console.log(`[skip] ${localPath} already exists`);
    continue;
  }
  try {
    await bucket.file(remoteName).download({ destination: localPath });
    const stat = fs.statSync(localPath);
    console.log(`[saved] ${localPath} size=${stat.size}`);
  } catch (e) {
    console.error(`[error] ${remoteName}: ${e.message}`);
  }
}
process.exit(0);
