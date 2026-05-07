// 2026-05-07 14:34:46 JST に発生した一斉 unscheduled 上書き事故の復旧
//
// 復旧方針:
//   - 4件: backup(01:13 JST)の status / statusEnteredAt / statusHistory に戻す
//   - 1件(力丸/タフト): backup に存在しないため、現場確認結果の status="b_wait" を設定
//
// 使い方:
//   GOOGLE_CLOUD_PROJECT=brightboard-4595a node scripts/restore-mass-unscheduled.mjs            (dry-run)
//   ... --execute                                                                                (書き込み)

import admin from 'firebase-admin';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const PROJECT_ID = 'brightboard-4595a';
const BUCKET = 'brightboard-4595a.firebasestorage.app';
const COLLECTION = 'boards/main/tasks';
const BACKUP_PATH = '/tmp/bb-forensics/brightboard-backup-2026-05-07.json';

const REVERT_FROM_BACKUP_IDS = [
  't1776836083278', // 木谷 / ライフ → thu
  't1777510120623', // 原田 / カローラ クロス → received
  't1777624418308', // 嶋田 / パッソ → b_wait
  't1777624567610', // 廣 / アルト ラパン → received
];
// backup に存在しないため現場確認で b_wait に
const HIRAKAWA_NEW_ID = 't1778117773430'; // 力丸 / タフト → b_wait

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

admin.initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
const db = admin.firestore();

const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
const backupById = new Map(backup.tasks.map(t => [t.id, t]));

const plan = [];

for (const id of REVERT_FROM_BACKUP_IDS) {
  const b = backupById.get(id);
  if (!b) {
    console.error(`[error] backupに見つかりません: ${id}`);
    process.exit(1);
  }
  plan.push({
    id,
    label: `${b.assignee || ''} / ${b.maker || ''} ${b.car || ''} ${b.number || ''}`.trim(),
    update: {
      status: b.status,
      statusEnteredAt: reviveTimestamps(b.statusEnteredAt),
      statusHistory: reviveTimestamps(b.statusHistory || []),
    },
    note: `→ ${b.status} (履歴 ${(b.statusHistory||[]).length} 件復元)`,
  });
}

// 力丸 / タフト
const cur = await db.collection(COLLECTION).doc(HIRAKAWA_NEW_ID).get();
if (!cur.exists) {
  console.error(`[error] 現在のFirestoreに存在しません: ${HIRAKAWA_NEW_ID}`);
  process.exit(1);
}
const curData = cur.data();
plan.push({
  id: HIRAKAWA_NEW_ID,
  label: `${curData.assignee || ''} / ${curData.maker || ''} ${curData.car || ''} ${curData.number || ''}`.trim(),
  update: {
    status: 'b_wait',
    statusEnteredAt: new Date().toISOString(),
    statusHistory: [],
  },
  note: '→ b_wait (現場確認による・新規カード履歴なし)',
});

console.log('');
console.log(`[plan] mode=${args.execute ? 'EXECUTE' : 'DRY-RUN'}`);
console.log('');
for (const p of plan) {
  console.log(`  ${p.id}  ${p.label}`);
  console.log(`    ${p.note}`);
  console.log(`    update: status=${p.update.status}, statusEnteredAt=${typeof p.update.statusEnteredAt === 'string' ? p.update.statusEnteredAt : '(Timestamp)'}, history.length=${p.update.statusHistory.length}`);
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
