// 5/5 ベースライン (stealth-wipe事故直前の最後のクリーン状態) を /tmp に保証する。
// /tmp は macOS 再起動で消えるため、毎朝の cron 前に呼び出して欠損時のみ Storage から再取得する。
import admin from 'firebase-admin';
import fs from 'node:fs';

const BASELINE_NAME = 'brightboard-backup-2026-05-05.json';
const LOCAL_PATH = `/tmp/bb-forensics/${BASELINE_NAME}`;

fs.mkdirSync('/tmp/bb-forensics', { recursive: true });
if (fs.existsSync(LOCAL_PATH)) {
  console.log(`[baseline] already present: ${LOCAL_PATH}`);
  process.exit(0);
}
admin.initializeApp({ projectId: 'brightboard-4595a', storageBucket: 'brightboard-4595a.firebasestorage.app' });
const bucket = admin.storage().bucket();
const file = bucket.file(`backups/2026/05/${BASELINE_NAME}`);
const [exists] = await file.exists();
if (!exists) {
  console.error(`[baseline] NOT FOUND in Storage: backups/2026/05/${BASELINE_NAME}`);
  process.exit(2);
}
await file.download({ destination: LOCAL_PATH });
console.log(`[baseline] downloaded: ${LOCAL_PATH}`);
process.exit(0);
