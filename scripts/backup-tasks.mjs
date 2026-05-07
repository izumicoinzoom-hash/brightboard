// BrightBoard 日次バックアップスクリプト
//
// 動作:
//  1. Firestore の boards/main/tasks を全件取得
//  2. UI の exportTasksAsJson と同形式の JSON を生成
//  3. Firebase Storage にアップロード: backups/YYYY/MM/brightboard-backup-YYYY-MM-DD.json
//
// 認証:
//  - ローカル: Application Default Credentials (gcloud auth application-default login 済み)
//  - CI: 環境変数 FIREBASE_SERVICE_ACCOUNT_JSON にサービスアカウント JSON 全文を設定
//
// 実行:
//  - ローカル手動: GOOGLE_CLOUD_PROJECT=brightboard-4595a node scripts/backup-tasks.mjs
//  - CI: .github/workflows/backup-firestore.yml が毎日 14:30 UTC (23:30 JST) に実行

import admin from 'firebase-admin';

const PROJECT_ID = 'brightboard-4595a';
const BUCKET = 'brightboard-4595a.firebasestorage.app';
const COLLECTION = 'boards/main/tasks';

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

// Firestore Timestamp を UI export と同じシリアライズ形式に変換
function serializeValue(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof admin.firestore.Timestamp) {
    return {
      type: 'firestore/timestamp/1.0',
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    };
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serializeValue(v);
    return out;
  }
  return value;
}

function jstToday() {
  const now = new Date();
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(jstMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const MM = String(d.getUTCMinutes()).padStart(2, '0');
  return { yyyy, mm, dd, dateStr: `${yyyy}-${mm}-${dd}`, timeStr: `${HH}${MM}` };
}

async function main() {
  initAdmin();
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  console.log(`[backup] reading ${COLLECTION}`);
  const snap = await db.collection(COLLECTION).get();
  const tasks = snap.docs.map((d) => serializeValue({ id: d.id, ...d.data() }));
  console.log(`[backup] tasks=${tasks.length}`);

  const payload = {
    exportedAt: new Date().toISOString(),
    taskCount: tasks.length,
    tasks,
  };

  const { yyyy, mm, dateStr, timeStr } = jstToday();
  const body = JSON.stringify(payload, null, 2);
  const saveOpts = {
    contentType: 'application/json; charset=utf-8',
    metadata: {
      cacheControl: 'private, max-age=0, no-transform',
      metadata: {
        taskCount: String(tasks.length),
        exportedAt: payload.exportedAt,
      },
    },
    resumable: false,
  };

  // 1) タイムスタンプ付きスナップショット（同日複数バックアップでも上書きされない監査痕）
  const stampedPath = `backups/${yyyy}/${mm}/brightboard-backup-${dateStr}-${timeStr}.json`;
  console.log(`[backup] uploading to gs://${BUCKET}/${stampedPath}`);
  await bucket.file(stampedPath).save(body, saveOpts);

  // 2) 日別エイリアス（restore-tasks.mjs --date=YYYY-MM-DD 互換、その日の最新を指す）
  const aliasPath = `backups/${yyyy}/${mm}/brightboard-backup-${dateStr}.json`;
  console.log(`[backup] updating alias gs://${BUCKET}/${aliasPath}`);
  await bucket.file(aliasPath).save(body, saveOpts);

  console.log(`[done] backup saved: ${tasks.length} tasks → ${stampedPath} + alias ${aliasPath}`);
}

main().catch((e) => {
  console.error('[error]', e);
  process.exit(1);
});
