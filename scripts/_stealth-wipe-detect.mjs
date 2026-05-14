// stealth partial-wipe detection
// 5/9 partial-wipe-detect.mjs は status=unscheduled のカードしか拾わなかった。
// しかし wipe 後に status を変更されたカード（例: 倉光 t1777184008684, b_done_p_wait）が取りこぼされる。
//
// このスクリプトは 5/5 backup を「ワイプ前の最後の確実なベースライン」として、
// 現在との差分から「assignee 末尾連結 + dots退化 + 主要フィールド消失」シグネチャを全件検出する。
//
// 5/5 を選ぶ理由: 5/7 backup では既にワイプ済みのカードが含まれるため。
// 5/5 と 5/1 で 倉光 の updatedAt が同一(1777525439)＝そのカードは 5/1 以降未編集と確認済み。
// よって 5/5 は wipe事故 (5/6前後) 直前の状態に最も近い。

import fs from 'node:fs';
import { LATER_STAGE_STATUSES } from '../src/lib/stages.js';

const BASELINE = '/tmp/bb-forensics/brightboard-backup-2026-05-05.json';
const CURRENT = '/tmp/bb-forensics/current.json';
const OUT = '/tmp/bb-forensics/stealth-wipe-victims.json';

function load(p) {
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const m = new Map();
  for (const t of d.tasks || []) m.set(t.id, t);
  return { meta: { exportedAt: d.exportedAt, taskCount: d.taskCount ?? (d.tasks||[]).length }, map: m };
}

function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function dotsAllWhite(arr) {
  return Array.isArray(arr) && arr.length && arr.every(x => x === 'white' || !x);
}

function tsToMs(ts) {
  if (!ts) return 0;
  if (typeof ts === 'object' && ts.seconds !== undefined) return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6);
  if (typeof ts === 'string') return new Date(ts).getTime();
  return 0;
}

function tsToISO(ts) { const ms = tsToMs(ts); return ms ? new Date(ms).toISOString() : ''; }

const A = load(BASELINE);
const B = load(CURRENT);
console.log(`[baseline 5/5] taskCount=${A.meta.taskCount}`);
console.log(`[current     ] taskCount=${B.meta.taskCount}`);

const TARGET_FIELDS = ['color', 'dots', 'car', 'number', 'colorNo', 'attachments'];
const victims = [];
const excludedIds = [];

for (const [id, ta] of A.map) {
  const tb = B.map.get(id);
  if (!tb) continue;

  // 修理中止カードは検知対象から除外（意図的なフィールド消去のため）
  if (tb.repairCancelled === true) {
    excludedIds.push(id);
    continue;
  }

  const wiped = [];
  for (const f of TARGET_FIELDS) {
    const av = ta[f];
    const bv = tb[f];
    if (f === 'dots') {
      if (Array.isArray(av) && av.some(x => x && x !== 'white') && dotsAllWhite(bv)) {
        wiped.push({ f, before: av, after: bv });
      }
      continue;
    }
    if (f === 'color') {
      if (typeof av === 'string' && av && av !== 'bg-white' && bv === 'bg-white') {
        wiped.push({ f, before: av, after: bv });
      }
      continue;
    }
    if (!isEmpty(av) && isEmpty(bv)) {
      wiped.push({ f, before: av, after: bv });
    }
  }

  // assignee 末尾連結シグネチャ: B.assignee = A.assignee + " " + (車種 or "新規車両")
  const aA = (ta.assignee || '').trim();
  const aB = (tb.assignee || '').trim();
  let assigneeSuffix = null;
  if (aA && aB && aB !== aA && aB.startsWith(aA + ' ')) {
    assigneeSuffix = aB.slice(aA.length + 1);
  }

  if (wiped.length === 0 && !assigneeSuffix) continue;

  victims.push({
    id,
    assignee_before: aA,
    assignee_after: aB,
    assignee_suffix_added: assigneeSuffix,
    status_before: ta.status,
    status_after: tb.status,
    wiped_fields: wiped.map(w => w.f),
    wiped_detail: wiped,
    statusHistoryLen_before: (ta.statusHistory || []).length,
    statusHistoryLen_after: (tb.statusHistory || []).length,
    updatedAt_before_iso: tsToISO(ta.updatedAt),
    updatedAt_after_iso: tsToISO(tb.updatedAt),
  });
}

// シグネチャ強度別に分類
const strong = victims.filter(v => v.wiped_fields.length > 0 && v.assignee_suffix_added);
const onlyWipe = victims.filter(v => v.wiped_fields.length > 0 && !v.assignee_suffix_added);
const onlySuffix = victims.filter(v => v.wiped_fields.length === 0 && v.assignee_suffix_added);

console.log(`\n========== 検出結果 ==========`);
console.log(`strong  (wipe + suffix): ${strong.length}`);
console.log(`onlyWipe(wipeのみ)     : ${onlyWipe.length}`);
console.log(`onlySuffix(suffixのみ) : ${onlySuffix.length}`);
console.log(`合計                   : ${victims.length}`);
console.log(`excluded(修理中止)     : ${excludedIds.length}`);

console.log('\n--- strong (wipe+suffix) ---');
for (const v of strong) {
  console.log(`  ${v.id}  status:${v.status_before}→${v.status_after}  「${v.assignee_before}」→「${v.assignee_after}」 (+${v.assignee_suffix_added})  消失=[${v.wiped_fields.join(',')}]`);
}

console.log('\n--- onlyWipe ---');
for (const v of onlyWipe.slice(0, 30)) {
  console.log(`  ${v.id}  ${v.status_before}→${v.status_after}  「${v.assignee_before}」 消失=[${v.wiped_fields.join(',')}]`);
}
if (onlyWipe.length > 30) console.log(`  ... +${onlyWipe.length - 30} more`);

console.log('\n--- onlySuffix ---');
for (const v of onlySuffix.slice(0, 30)) {
  console.log(`  ${v.id}  ${v.status_before}→${v.status_after}  「${v.assignee_before}」→「${v.assignee_after}」 (+${v.assignee_suffix_added})`);
}
if (onlySuffix.length > 30) console.log(`  ... +${onlySuffix.length - 30} more`);

fs.writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  baseline: A.meta,
  current: B.meta,
  fields_checked: TARGET_FIELDS,
  counts: { strong: strong.length, onlyWipe: onlyWipe.length, onlySuffix: onlySuffix.length, total: victims.length, excluded: excludedIds.length },
  excluded_ids: excludedIds.slice(0, 5),
  strong, onlyWipe, onlySuffix,
}, null, 2));
console.log(`\n[saved] ${OUT}`);
