// BrightBoard 特定時刻時点へのピンポイント巻き戻しスクリプト
//
// 使い方:
//   # dry-run（差分のみ表示）
//   GOOGLE_CLOUD_PROJECT=brightboard-4595a node scripts/revert-to-time.mjs --at=2026-05-07T14:00:00+09:00
//
//   # 実書き込み
//   ... --at=... --execute
//
// 動作:
//   1. 全カードを取得
//   2. 各カードについて statusHistory を遡り、--at 時点で active だった status を特定
//   3. status / statusEnteredAt を当時の値に戻し、--at より後の statusHistory エントリを削除
//   4. --at より前にカード自体が存在しなかった場合は触らない（warn のみ）

import admin from 'firebase-admin';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const PROJECT_ID = 'brightboard-4595a';
const BUCKET = 'brightboard-4595a.firebasestorage.app';
const COLLECTION = 'boards/main/tasks';

function parseArgs(argv) {
  const args = { execute: false, yes: false, toStatuses: null };
  for (const a of argv.slice(2)) {
    if (a === '--execute') args.execute = true;
    else if (a === '--yes') args.yes = true;
    else if (a.startsWith('--at=')) args.at = a.slice('--at='.length);
    else if (a.startsWith('--to-statuses=')) args.toStatuses = a.slice('--to-statuses='.length).split(',').map(s => s.trim()).filter(Boolean);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!args.at) throw new Error('--at=ISO8601 を指定してください');
  args.atDate = new Date(args.at);
  if (isNaN(args.atDate.getTime())) throw new Error(`--at の日時が不正: ${args.at}`);
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

function toMs(v) {
  if (!v) return null;
  if (v instanceof admin.firestore.Timestamp) return v.toMillis();
  if (typeof v === 'string') {
    const t = new Date(v).getTime();
    return isNaN(t) ? null : t;
  }
  if (typeof v === 'object' && typeof v.seconds === 'number') {
    return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  }
  return null;
}

function summarize(t) {
  return [
    t.id,
    t.assignee || '担当未設定',
    `${t.maker || ''} ${t.car || ''}`.trim() || '車種未設定',
    t.number || '',
  ].filter(Boolean).join(' / ');
}

async function confirm(q) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ans = (await rl.question(`${q} [yes/no]: `)).trim().toLowerCase();
  rl.close();
  return ans === 'yes' || ans === 'y';
}

async function main() {
  const args = parseArgs(process.argv);
  const cutoffMs = args.atDate.getTime();
  console.log(`[cutoff] ${args.atDate.toISOString()} (${args.at})`);

  initAdmin();
  const db = admin.firestore();
  const snap = await db.collection(COLLECTION).get();
  console.log(`[firestore] tasks=${snap.size}`);

  const plan = [];
  const skipped = [];

  const toFilter = args.toStatuses && args.toStatuses.length ? new Set(args.toStatuses) : null;

  snap.forEach((doc) => {
    const t = { id: doc.id, ...doc.data() };
    if (toFilter && !toFilter.has(t.status)) return; // 現在の列が対象外
    const enteredMs = toMs(t.statusEnteredAt);
    if (enteredMs === null || enteredMs <= cutoffMs) return; // 既にcutoff以前から動いてない
    const history = Array.isArray(t.statusHistory) ? t.statusHistory : [];
    // cutoff時点で active だった entry を特定（enteredAt <= cutoff < exitedAt）
    let activeAtCutoff = null;
    let activeIdx = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      const e = history[i];
      const eIn = toMs(e.enteredAt);
      const eOut = toMs(e.exitedAt);
      if (eIn === null || eOut === null) continue;
      if (eIn <= cutoffMs && cutoffMs < eOut) {
        activeAtCutoff = e;
        activeIdx = i;
        break;
      }
    }
    if (!activeAtCutoff) {
      // cutoff時点で存在しなかった可能性
      skipped.push({ task: t, reason: 'cutoff時点のhistoryエントリが見つかりません（カード自体がcutoff後に作成された可能性）' });
      return;
    }
    const newHistory = history.slice(0, activeIdx); // activeAtCutoff より前のエントリのみ残す
    plan.push({
      id: t.id,
      summary: summarize(t),
      currentStatus: t.status,
      revertStatus: activeAtCutoff.status,
      revertEnteredAt: activeAtCutoff.enteredAt,
      droppedCount: history.length - activeIdx,
      lastMoveBy: history[history.length - 1]?.byUser || '(不明)',
      lastMoveAt: history[history.length - 1]?.exitedAt || t.statusEnteredAt,
      newHistory,
    });
  });

  console.log('');
  console.log(`[plan] revert=${plan.length}, skip=${skipped.length}`);
  console.log('');
  for (const p of plan) {
    console.log(`  ${p.summary}`);
    console.log(`    [${p.currentStatus}] → [${p.revertStatus}]  drop=${p.droppedCount} entries  lastMove=${p.lastMoveAt} by=${p.lastMoveBy}`);
  }
  if (skipped.length) {
    console.log('');
    console.log('[skipped]');
    for (const s of skipped) {
      console.log(`  ${summarize(s.task)} — ${s.reason}`);
    }
  }

  if (!args.execute) {
    console.log('');
    console.log('[dry-run] 実書き込みなし。--execute を付けて再実行してください。');
    return;
  }

  if (!args.yes) {
    console.log('');
    const ok = await confirm(`本当に ${plan.length} 件のカードを巻き戻しますか？`);
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
  for (const p of plan) {
    batch.update(db.collection(COLLECTION).doc(p.id), {
      status: p.revertStatus,
      statusEnteredAt: p.revertEnteredAt,
      statusHistory: p.newHistory,
    });
    opCount++;
    if (opCount >= 450) await flush();
  }
  await flush();
  console.log('');
  console.log(`[done] ${plan.length} 件を巻き戻しました。`);
}

main().catch((e) => {
  console.error('[error]', e.message || e);
  process.exit(1);
});
