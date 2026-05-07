// バックアップ間で「予約→unscheduled補完」被害候補を検出 v2
// 5/7 (pre-incident, 23:30 JST 5/6 想定) と current.json (post-incident, 14:55 JST 5/7) も含めて検証
import fs from 'node:fs';

const dates = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-07'];
const pairs = [
  ['2026-05-01', '2026-05-02'],
  ['2026-05-02', '2026-05-03'],
  ['2026-05-03', '2026-05-04'],
  ['2026-05-04', '2026-05-05'],
  ['2026-05-05', '2026-05-07'],
  ['2026-05-07', 'current'],   // 5/7のbackup → 5/7 14:55 JST current（インシデント直後）
];

function loadBackup(date) {
  const path = date === 'current'
    ? '/tmp/bb-forensics/current.json'
    : `/tmp/bb-forensics/brightboard-backup-${date}.json`;
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  const tasks = data.tasks || [];
  const map = new Map();
  for (const t of tasks) map.set(t.id, t);
  return { meta: { exportedAt: data.exportedAt, taskCount: data.taskCount ?? tasks.length }, map };
}

const backups = {};
for (const d of [...dates, 'current']) {
  backups[d] = loadBackup(d);
  console.log(`[loaded] ${d} exportedAt=${backups[d].meta.exportedAt} taskCount=${backups[d].meta.taskCount}`);
}

const allVictims = new Map();

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
  console.log(`  ${id}  firstPair=${v.firstPair}  A=${v.A_status}  ${v.assignee}/${v.maker}/${v.car}/${v.number}`);
}

fs.writeFileSync('/tmp/bb-forensics/victims-report.json', JSON.stringify({
  pairs: pairs.map(([a, b]) => ({ a, b })),
  uniqueVictims: Array.from(allVictims.entries()).map(([id, v]) => ({ id, ...v })),
}, null, 2));
console.log('\n[saved] /tmp/bb-forensics/victims-report.json');

process.exit(0);
