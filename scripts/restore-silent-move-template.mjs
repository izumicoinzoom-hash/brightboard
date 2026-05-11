// silent-move 復旧テンプレ。複製して使う。
//
// 使い方:
//   1. このファイルを `restore-YYYY-MM-DD-HHMM.mjs` にコピー
//   2. VICTIM_IDS と BACKUP_PATH を埋める
//   3. dry-run: GOOGLE_CLOUD_PROJECT=brightboard-4595a node scripts/restore-YYYY-MM-DD-HHMM.mjs
//   4. execute: 上に --execute を付ける（--yes で対話スキップ）

import admin from 'firebase-admin';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const PROJECT_ID = 'brightboard-4595a';
const BUCKET = 'brightboard-4595a.firebasestorage.app';
const COLLECTION = 'boards/main/tasks';

// === 事故ごとに埋める ===
const INCIDENT_LABEL = 'YYYY-MM-DD HH:MM JST silent-move';
const BACKUP_PATH = '/tmp/bb-forensics/brightboard-backup-YYYY-MM-DD.json';
const VICTIM_IDS = [
  // 'tNNNNNNNNNNN', // 担当 / メーカー 車種 番号 → 元status
];
// ========================

const args = { execute: false, yes: false };
for (const a of process.argv.slice(2)) {
  if (a === '--execute') args.execute = true;
  else if (a === '--yes') args.yes = true;
}

function reviveTimestamps(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(reviveTimestamps);
  if (typeof value === 'object') {
    if (
      value.type === 'firestore/timestamp/1.0' &&
      typeof value.seconds === 'number' &&
      typeof value.nanoseconds === 'number'
    ) {
      return new admin.firestore.Timestamp(value.seconds, value.nanoseconds);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = reviveTimestamps(v);
    return out;
  }
  return value;
}

async function confirm(q) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ans = (await rl.question(`${q} [yes/no]: `)).trim().toLowerCase();
  rl.close();
  return ans === 'yes' || ans === 'y';
}

if (VICTIM_IDS.length === 0) {
  console.error('[error] VICTIM_IDS が空です。スクリプトを編集してください。');
  process.exit(1);
}
if (BACKUP_PATH.includes('YYYY-MM-DD')) {
  console.error('[error] BACKUP_PATH が未設定です。スクリプトを編集してください。');
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
const db = admin.firestore();

const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
const backupById = new Map(backup.tasks.map(t => [t.id, t]));

const plan = [];
const missing = [];
for (const id of VICTIM_IDS) {
  const b = backupById.get(id);
  if (!b) {
    missing.push(id);
    continue;
  }
  plan.push({
    id,
    label: `${b.assignee || ''} / ${b.maker || ''} ${b.car || ''} ${b.number || ''}`.trim(),
    update: {
      status: b.status,
      statusEnteredAt: reviveTimestamps(b.statusEnteredAt),
      statusHistory: reviveTimestamps(b.statusHistory || []),
    },
    histLen: (b.statusHistory || []).length,
  });
}

if (missing.length > 0) {
  console.error(`[error] backupに見つからないID: ${missing.length}件`);
  for (const id of missing) console.error(`  ${id}`);
  process.exit(1);
}

console.log('');
console.log(`[incident] ${INCIDENT_LABEL}`);
console.log(`[plan] mode=${args.execute ? 'EXECUTE' : 'DRY-RUN'}  count=${plan.length}`);
console.log(`[source] ${BACKUP_PATH} (exportedAt=${backup.exportedAt})`);
console.log('');
for (const p of plan) {
  console.log(`  ${p.id}  ${p.label}`);
  console.log(`    → status=${p.update.status}  history=${p.histLen}件復元`);
}

if (!args.execute) {
  console.log('');
  console.log('[dry-run] 実書き込みなし。--execute で実行。');
  process.exit(0);
}

if (!args.yes) {
  console.log('');
  const ok = await confirm(`本当に ${plan.length} 件を更新しますか？`);
  if (!ok) {
    console.log('[abort] 中止しました。');
    process.exit(0);
  }
}

const batch = db.batch();
for (const p of plan) {
  batch.update(db.collection(COLLECTION).doc(p.id), p.update);
}
await batch.commit();
console.log(`[done] ${plan.length} 件を復元しました。`);
process.exit(0);
