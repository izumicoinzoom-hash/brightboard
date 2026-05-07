// バックアップ間で「予約→unscheduled補完」被害候補を検出
import fs from 'node:fs';

const dates = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-07'];
const pairs = [
  ['2026-05-01', '2026-05-02'],
  ['2026-05-02', '2026-05-03'],
  ['2026-05-03', '2026-05-04'],
  ['2026-05-04', '2026-05-05'],
  ['2026-05-05', '2026-05-07'],
];

// 既に5/7に修正済みのID 5件（除外対象）
// このリストは未確定なので、検出後に出力して人間が照合できるようにする
const alreadyFixed = new Set([
  // ここに既知の修正済みIDを入れる（指示で指定なし、推定で空）
]);

function loadBackup(date) {
  const path = `/tmp/bb-forensics/brightboard-backup-${date}.json`;
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  const tasks = data.tasks || [];
  const map = new Map();
  for (const t of tasks) map.set(t.id, t);
  return { meta: { exportedAt: data.exportedAt, taskCount: data.taskCount ?? tasks.length }, map };
}

const backups = {};
for (const d of dates) {
  backups[d] = loadBackup(d);
  console.log(`[loaded] ${d} exportedAt=${backups[d].meta.exportedAt} taskCount=${backups[d].meta.taskCount}`);
}

// 予約管理外のステータス候補（指示書から）
const RESERVATION_OUT = new Set([
  'b_wait', 'b_doing', 'received', 'painting', 'polish', 'prep_done',
  'b_done_p_wait', 'assembly_wait', 'assembly_done_both', 'p_only',
  'completed', 'delivery_wait',
]);

const allVictims = new Map(); // id -> { firstDetectedPair, A_status, B_statusHistoryLen, ... }

console.log('\n========== ペア比較 ==========');
for (const [a, b] of pairs) {
  const A = backups[a].map;
  const B = backups[b].map;
  const victims = [];
  for (const [id, ta] of A) {
    const tb = B.get(id);
    if (!tb) continue;
    const aStatus = ta.status;
    const bStatus = tb.status;
    const bHist = Array.isArray(tb.statusHistory) ? tb.statusHistory : [];
    if (aStatus === 'unscheduled') continue;
    if (bStatus !== 'unscheduled') continue;
    if (bHist.length !== 0) continue;
    // ヒット
    victims.push({
      id,
      A_status: aStatus,
      B_statusHistoryLen: bHist.length,
      assignee: ta.assignee || tb.assignee || '',
      maker: ta.maker || tb.maker || '',
      car: ta.car || tb.car || '',
      number: ta.number || tb.number || '',
      A_statusHistoryLen: Array.isArray(ta.statusHistory) ? ta.statusHistory.length : 0,
    });
  }
  console.log(`\n--- ${a} → ${b}  victims=${victims.length} ---`);
  for (const v of victims) {
    console.log(`  ${v.id}  A=${v.A_status}(hist=${v.A_statusHistoryLen}) → B=unscheduled(hist=0)  ${v.assignee}/${v.maker}/${v.car}/${v.number}`);
    if (!allVictims.has(v.id)) {
      allVictims.set(v.id, { firstPair: `${a}→${b}`, ...v });
    }
  }
}

console.log('\n========== 累計被害ユニーク集合 ==========');
console.log(`total unique victims = ${allVictims.size}`);
for (const [id, v] of allVictims) {
  const fixed = alreadyFixed.has(id) ? ' [ALREADY FIXED]' : '';
  console.log(`  ${id}  firstPair=${v.firstPair}  A=${v.A_status}  ${v.assignee}/${v.maker}/${v.car}/${v.number}${fixed}`);
}

// JSON出力
fs.writeFileSync('/tmp/bb-forensics/victims-report.json', JSON.stringify({
  pairs: pairs.map(([a, b]) => ({ a, b })),
  uniqueVictims: Array.from(allVictims.entries()).map(([id, v]) => ({ id, ...v })),
}, null, 2));
console.log('\n[saved] /tmp/bb-forensics/victims-report.json');

process.exit(0);
