// 修理中止フラグ migration script
//
// 目的:
//   特定の task ドキュメントに repairCancelled フラグを安全に立てる（バックフィル用）。
//   safeUpsertTask 等のアプリ側ガードを経由せず、admin SDK で対象フィールドのみ
//   ピンポイントで update() する。他フィールドは一切触らない。
//
// 同時に boards/main/auditLogs に追記して、後追い可能にする。
//
// 使い方:
//   # まずは現状確認（書き込まない）
//   GOOGLE_CLOUD_PROJECT=brightboard-4595a \
//     node scripts/set-repair-cancelled.mjs --dry-run
//
//   # 本番反映（ユーザー承認を得てから）
//   GOOGLE_CLOUD_PROJECT=brightboard-4595a \
//     node scripts/set-repair-cancelled.mjs --execute
//
//   # 他カードを指定
//   ... --task-id t1778228111102
//
// デフォルト対象: t1778228111102 = 古谷C-HR

import admin from 'firebase-admin';

const PROJECT_ID = 'brightboard-4595a';
const TASKS_COLLECTION = 'boards/main/tasks';
const AUDIT_COLLECTION = 'boards/main/auditLogs';
const DEFAULT_TASK_ID = 't1778228111102'; // 古谷C-HR

// ---- 引数パース ----
const args = { dryRun: false, execute: false, taskId: DEFAULT_TASK_ID };
const rawArgs = process.argv.slice(2);
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--dry-run') args.dryRun = true;
  else if (a === '--execute') args.execute = true;
  else if (a === '--task-id') {
    const v = rawArgs[i + 1];
    if (!v || v.startsWith('--')) {
      console.error('[error] --task-id requires a value');
      process.exit(1);
    }
    args.taskId = v;
    i++;
  } else if (a === '--help' || a === '-h') {
    console.log('Usage: node scripts/set-repair-cancelled.mjs [--dry-run | --execute] [--task-id <id>]');
    process.exit(0);
  } else {
    console.error(`[error] unknown argument: ${a}`);
    process.exit(1);
  }
}

if (!args.dryRun && !args.execute) {
  console.error('[error] specify either --dry-run or --execute');
  process.exit(1);
}
if (args.dryRun && args.execute) {
  console.error('[error] --dry-run and --execute are mutually exclusive');
  process.exit(1);
}

// ---- Firestore init ----
try {
  admin.initializeApp({ projectId: PROJECT_ID });
} catch (e) {
  console.error('[error] firebase admin init failed:', e?.message || e);
  process.exit(1);
}
const db = admin.firestore();

// ---- メイン ----
async function main() {
  const taskId = args.taskId;
  const mode = args.execute ? 'EXECUTE' : 'DRY-RUN';
  console.log('');
  console.log(`[mode] ${mode}`);
  console.log(`[task] ${TASKS_COLLECTION}/${taskId}`);
  console.log('');

  const ref = db.collection(TASKS_COLLECTION).doc(taskId);
  let snap;
  try {
    snap = await ref.get();
  } catch (e) {
    console.error(`[error] failed to fetch task: ${e?.message || e}`);
    process.exit(1);
  }

  if (!snap.exists) {
    console.error(`[error] task not found: ${taskId}`);
    process.exit(1);
  }

  const data = snap.data() || {};
  const prevRepairCancelled = Object.prototype.hasOwnProperty.call(data, 'repairCancelled')
    ? data.repairCancelled
    : null;

  console.log('[current]');
  console.log(`  assignee         : ${JSON.stringify(data.assignee ?? null)}`);
  console.log(`  status           : ${JSON.stringify(data.status ?? null)}`);
  console.log(`  repairCancelled  : ${JSON.stringify(prevRepairCancelled)}`);
  console.log('');

  // すでに true なら NO-OP
  if (prevRepairCancelled === true) {
    console.log('[noop] repairCancelled is already true. nothing to do.');
    process.exit(0);
  }

  const nowIso = new Date().toISOString();
  const updatePayload = {
    repairCancelled: true,
    repairCancelledReason: 'manual_backfill_2026-05-14',
    repairCancelledAt: nowIso,
    repairCancelledBy: 'claude_migration',
  };

  console.log('[plan] would update with:');
  for (const [k, v] of Object.entries(updatePayload)) {
    console.log(`  ${k.padEnd(22)} ← ${JSON.stringify(v)}`);
  }
  console.log('');

  if (args.dryRun) {
    console.log('[dry-run] no write performed. re-run with --execute to apply.');
    process.exit(0);
  }

  // ---- execute ----
  try {
    await ref.update(updatePayload);
  } catch (e) {
    console.error(`[error] task update failed: ${e?.message || e}`);
    process.exit(1);
  }
  console.log(`[done] updated ${TASKS_COLLECTION}/${taskId}`);

  // ---- audit log ----
  // 重要: firebase.js (src/firebase.js writeAuditLog) のスキーマに揃える。
  // ランタイム側は path / docId / ts を使うので、本 script も同形で書き込む。
  // （以前は collection / documentId / timestamp を使っていたが、運用クエリ時に
  //  「ランタイム書込み」と「migration 書込み」がスキーマ不一致で混在し検索困難になるため。）
  try {
    await db.collection(AUDIT_COLLECTION).add({
      path: TASKS_COLLECTION,
      docId: taskId,
      action: 'upsert',
      actor: 'claude_migration',
      actorEmail: null,
      deviceLabel: 'cli/set-repair-cancelled.mjs',
      ua: null,
      url: null,
      reason: 'repair_cancelled_toggle',
      before: { repairCancelled: prevRepairCancelled },
      after: { repairCancelled: true },
      ts: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[done] appended audit log to ${AUDIT_COLLECTION}`);
  } catch (e) {
    console.error(`[warn] audit log append failed (task update already done): ${e?.message || e}`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('[error] unexpected:', e?.message || e);
  process.exit(1);
});
