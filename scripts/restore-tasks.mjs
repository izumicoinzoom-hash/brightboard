// BrightBoard カード復元スクリプト
//
// 使い方:
//   # Storage から指定日付のバックアップで dry-run（差分のみ表示）
//   GOOGLE_CLOUD_PROJECT=brightboard-4595a npm run restore -- --date=2026-04-30
//
//   # 実書き込み
//   GOOGLE_CLOUD_PROJECT=brightboard-4595a npm run restore -- --date=2026-04-30 --execute
//
//   # バックアップ後に追加された新規カードは消さない（Plan B / 推奨）
//   ... --keep-newer
//
//   # ローカルの JSON ファイルから復元
//   ... --file=/path/to/brightboard-backup-2026-04-30.json
//
// 認証:
//   ローカル: gcloud auth application-default login で得た ADC
//   CI: 環境変数 FIREBASE_SERVICE_ACCOUNT_JSON
//
// 安全装置:
//   --execute なしでは差分表示のみ
//   削除予定カードは ID と主要フィールドを必ずプレビュー表示
//   500 op/batch 制限を考慮し 450 op で flush

import admin from 'firebase-admin';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const PROJECT_ID = 'brightboard-4595a';
const BUCKET = 'brightboard-4595a.firebasestorage.app';
const COLLECTION = 'boards/main/tasks';

function parseArgs(argv) {
  const args = { execute: false, keepNewer: false, yes: false };
  for (const a of argv.slice(2)) {
    if (a === '--execute') args.execute = true;
    else if (a === '--keep-newer') args.keepNewer = true;
    else if (a === '--yes') args.yes = true;
    else if (a.startsWith('--date=')) args.date = a.slice('--date='.length);
    else if (a.startsWith('--file=')) args.file = a.slice('--file='.length);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!args.date && !args.file) {
    throw new Error('--date=YYYY-MM-DD か --file=path のどちらかを指定してください');
  }
  return args;
}

function initAdmin() {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(saJson)),
      projectId: PROJECT_ID,
      storageBucket: BUCKET,
    });
  } else {
    admin.initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
  }
}

// JSON シリアライズされた Firestore Timestamp を復元
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

async function loadBackupFromStorage(date) {
  const [yyyy, mm] = date.split('-');
  const objectPath = `backups/${yyyy}/${mm}/brightboard-backup-${date}.json`;
  const bucket = admin.storage().bucket();
  const file = bucket.file(objectPath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`バックアップが存在しません: gs://${BUCKET}/${objectPath}`);
  }
  console.log(`[load] gs://${BUCKET}/${objectPath}`);
  const [buf] = await file.download();
  return JSON.parse(buf.toString('utf8'));
}

function loadBackupFromFile(path) {
  console.log(`[load] ${path}`);
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function summarizeTask(t) {
  const parts = [
    t.id,
    t.assignee || '担当未設定',
    `${t.maker || ''} ${t.car || ''}`.trim() || '車種未設定',
    t.number || '',
    `[${t.status}]`,
  ];
  return parts.filter(Boolean).join(' / ');
}

async function confirm(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ans = (await rl.question(`${question} [yes/no]: `)).trim().toLowerCase();
  rl.close();
  return ans === 'yes' || ans === 'y';
}

async function main() {
  const args = parseArgs(process.argv);
  initAdmin();
  const db = admin.firestore();

  const backup = args.file ? loadBackupFromFile(args.file) : await loadBackupFromStorage(args.date);
  const backupTasks = backup.tasks || [];
  console.log(`[backup] tasks=${backupTasks.length} exportedAt=${backup.exportedAt}`);

  const backupIds = new Set(backupTasks.map((t) => t.id).filter(Boolean));

  const snap = await db.collection(COLLECTION).get();
  const currentDocs = new Map();
  snap.forEach((d) => currentDocs.set(d.id, d.data()));
  console.log(`[firestore] current docs=${currentDocs.size}`);

  const toDelete = [...currentDocs.keys()].filter((id) => !backupIds.has(id));
  const toUpsert = backupTasks;

  console.log('');
  console.log(`[plan] mode=${args.execute ? 'EXECUTE' : 'DRY-RUN'} keep-newer=${args.keepNewer}`);
  console.log(`[plan] upsert=${toUpsert.length}`);
  console.log(`[plan] delete=${toDelete.length}${args.keepNewer ? ' (--keep-newer により保持)' : ''}`);

  if (toDelete.length > 0) {
    console.log('');
    console.log(args.keepNewer ? '[保持されるカード]' : '[削除されるカード]');
    for (const id of toDelete) {
      console.log(`  - ${summarizeTask({ id, ...currentDocs.get(id) })}`);
    }
  }

  if (!args.execute) {
    console.log('');
    console.log('[dry-run] 実書き込みなし。--execute を付けて再実行してください。');
    return;
  }

  if (!args.yes) {
    console.log('');
    const ok = await confirm(
      `本当に Firestore ${COLLECTION} を上書きしますか？(upsert ${toUpsert.length}, delete ${args.keepNewer ? 0 : toDelete.length})`
    );
    if (!ok) {
      console.log('[abort] 中止しました。');
      return;
    }
  }

  let opCount = 0;
  let batch = db.batch();
  const flush = async () => {
    if (opCount === 0) return;
    await batch.commit();
    opCount = 0;
    batch = db.batch();
  };

  if (!args.keepNewer) {
    for (const id of toDelete) {
      batch.delete(db.collection(COLLECTION).doc(id));
      opCount++;
      if (opCount >= 450) await flush();
    }
  }

  for (const t of toUpsert) {
    const { id, ...rest } = t;
    if (!id) continue;
    batch.set(db.collection(COLLECTION).doc(id), reviveTimestamps(rest));
    opCount++;
    if (opCount >= 450) await flush();
  }

  await flush();
  console.log('');
  console.log('[done] 復元完了');
}

main().catch((e) => {
  console.error('[error]', e.message || e);
  process.exit(1);
});
