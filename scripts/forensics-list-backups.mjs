// 直近のバックアップ一覧と最新のものをローカルに保存
import admin from 'firebase-admin';
import fs from 'node:fs';

admin.initializeApp({ projectId: 'brightboard-4595a', storageBucket: 'brightboard-4595a.firebasestorage.app' });
const bucket = admin.storage().bucket();

const [files] = await bucket.getFiles({ prefix: 'backups/2026/05/' });
files.sort((a, b) => a.name.localeCompare(b.name));
console.log('[backups]');
for (const f of files) {
  const meta = f.metadata;
  console.log(`  ${f.name}  size=${meta.size}  updated=${meta.updated}`);
}
const latest = files[files.length - 1];
if (latest) {
  const localPath = `/tmp/bb-forensics/${latest.name.split('/').pop()}`;
  fs.mkdirSync('/tmp/bb-forensics', { recursive: true });
  await latest.download({ destination: localPath });
  console.log(`[saved] ${localPath}`);
}
// 現在のFirestoreスナップショットも保存
const db = admin.firestore();
const snap = await db.collection('boards/main/tasks').get();
const current = snap.docs.map(d => ({ id: d.id, ...d.data() }));
fs.writeFileSync('/tmp/bb-forensics/current.json', JSON.stringify({ exportedAt: new Date().toISOString(), tasks: current }, null, 2));
console.log(`[saved] /tmp/bb-forensics/current.json (tasks=${current.length})`);
process.exit(0);
