// BrightBoard 代車専用スナップショット（30分毎）
//
// 動作:
//  1. boards/main/tasks のうち代車関連のみを抽出（loanerType !== 'none' || loanerCarId 非空 || assignee に「代車」）
//  2. boards/main/reservations 全件
//  3. fleetCars 全件（代車マスタ）
//  4. rentalCompanies 全件（レンタル会社マスタ）
//  5. Firebase Storage に gs://.../backups/loaner/YYYY/MM/DD/HHmm.json で保存
//
// 認証:
//  - ローカル: Application Default Credentials
//  - CI: 環境変数 FIREBASE_SERVICE_ACCOUNT_JSON
//
// 実行:
//  - ローカル: GOOGLE_CLOUD_PROJECT=brightboard-4595a node scripts/backup-loaner-snapshot.mjs
//  - CI: .github/workflows/backup-loaner.yml が */30 * * * * で実行

import admin from 'firebase-admin';

const PROJECT_ID = 'brightboard-4595a';
const BUCKET = 'brightboard-4595a.firebasestorage.app';

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

function jstNow() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(jst.getUTCDate()).padStart(2, '0');
  const HH = String(jst.getUTCHours()).padStart(2, '0');
  const MM = String(jst.getUTCMinutes()).padStart(2, '0');
  return { yyyy, mm, dd, HH, MM };
}

function isLoanerTask(t) {
  if (t.loanerType && t.loanerType !== 'none') return true;
  if (t.loanerCarId) return true;
  if (typeof t.assignee === 'string' && t.assignee.includes('代車')) return true;
  return false;
}

async function fetchCollection(db, path) {
  const snap = await db.collection(path).get();
  return snap.docs.map((d) => serializeValue({ id: d.id, ...d.data() }));
}

async function main() {
  initAdmin();
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  console.log('[loaner-snapshot] reading collections');
  const [tasks, reservations, fleetCars, rentalCompanies] = await Promise.all([
    fetchCollection(db, 'boards/main/tasks'),
    fetchCollection(db, 'boards/main/reservations'),
    fetchCollection(db, 'fleetCars'),
    fetchCollection(db, 'rentalCompanies'),
  ]);

  const loanerTasks = tasks.filter(isLoanerTask);
  console.log(
    `[loaner-snapshot] tasks=${tasks.length} (loaner=${loanerTasks.length}) ` +
      `reservations=${reservations.length} fleetCars=${fleetCars.length} rentalCompanies=${rentalCompanies.length}`
  );

  const payload = {
    exportedAt: new Date().toISOString(),
    source: 'backup-loaner-snapshot',
    counts: {
      totalTasks: tasks.length,
      loanerTasks: loanerTasks.length,
      reservations: reservations.length,
      fleetCars: fleetCars.length,
      rentalCompanies: rentalCompanies.length,
    },
    loanerTasks,
    reservations,
    fleetCars,
    rentalCompanies,
  };

  const { yyyy, mm, dd, HH, MM } = jstNow();
  const objectPath = `backups/loaner/${yyyy}/${mm}/${dd}/${HH}${MM}.json`;
  const file = bucket.file(objectPath);

  console.log(`[loaner-snapshot] uploading to gs://${BUCKET}/${objectPath}`);
  await file.save(JSON.stringify(payload, null, 2), {
    contentType: 'application/json; charset=utf-8',
    metadata: {
      cacheControl: 'private, max-age=0, no-transform',
      metadata: {
        loanerTaskCount: String(loanerTasks.length),
        reservationCount: String(reservations.length),
        fleetCarCount: String(fleetCars.length),
        exportedAt: payload.exportedAt,
      },
    },
    resumable: false,
  });
  console.log(`[done] loaner snapshot saved: gs://${BUCKET}/${objectPath}`);
}

main().catch((e) => {
  console.error('[error]', e);
  process.exit(1);
});
