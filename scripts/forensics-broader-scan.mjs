// 念のための広い検出: statusHistory が縮んだ／消えたケース全般
import fs from 'node:fs';

const dates = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-07'];
const pairs = [];
for (let i = 0; i < dates.length - 1; i++) pairs.push([dates[i], dates[i + 1]]);

function loadBackup(date) {
  const path = `/tmp/bb-forensics/brightboard-backup-${date}.json`;
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  const tasks = data.tasks || [];
  const map = new Map();
  for (const t of tasks) map.set(t.id, t);
  return map;
}

const backups = {};
for (const d of dates) backups[d] = loadBackup(d);

console.log('========== broader scan: any status→unscheduled transition ==========');
for (const [a, b] of pairs) {
  const A = backups[a];
  const B = backups[b];
  let countToUnsched = 0;
  let countHistShrink = 0;
  const examples = [];
  for (const [id, ta] of A) {
    const tb = B.get(id);
    if (!tb) continue;
    const aStatus = ta.status;
    const bStatus = tb.status;
    const aHistLen = Array.isArray(ta.statusHistory) ? ta.statusHistory.length : 0;
    const bHistLen = Array.isArray(tb.statusHistory) ? tb.statusHistory.length : 0;
    if (aStatus !== 'unscheduled' && bStatus === 'unscheduled') {
      countToUnsched++;
      examples.push({ id, type: 'status→unsched', aStatus, aHistLen, bHistLen, info: `${ta.assignee||''}/${ta.maker||''}/${ta.car||''}/${ta.number||''}` });
    }
    if (aHistLen > 0 && bHistLen === 0) {
      countHistShrink++;
    }
  }
  console.log(`\n${a}→${b}:  status→unsched=${countToUnsched}  histShrinkToZero=${countHistShrink}`);
  for (const e of examples) {
    console.log(`  ${e.id} ${e.aStatus}(hist=${e.aHistLen})→unsched(hist=${e.bHistLen}) ${e.info}`);
  }
}
process.exit(0);
