# BB silent-move 復旧ランブック

複数カードが意図せず `status=unscheduled`（予約管理/入庫日未定）に **silent-move** される事故の検出→復旧手順。

**シグネチャ**: 移動後の `statusHistory.length === 0`（履歴ごと吹き飛ぶ）。

事例: 2026-05-07 14:34（5件） / 2026-05-07 15:38（13件） / 2026-05-09 / 2026-05-10。

---

## 0. 即時対応（事故報告を受けたら）

1. 報告者から **発生時刻**（おおよそ）と **被害カードの心当たり**（営業担当・車種・番号）をヒアリング
2. `boards/main/auditLogs` に該当時刻周辺の `task_write_blocked` 通知が来ていないか Discord で確認
3. PITR が有効（2026-05-08〜）なら 7 日以内の任意時点を巻き戻し可能

---

## 1. 最新スナップショット取得

```bash
cd 清田自動車/brightboard-src
mkdir -p /tmp/bb-forensics
GOOGLE_CLOUD_PROJECT=brightboard-4595a node scripts/_fetch-current-tmp.mjs
# → /tmp/bb-forensics/current.json
```

事故前直近の日次バックアップ（Cloud Storage `backups/YYYY/MM/`）も取得:

```bash
node scripts/forensics-download-range.mjs --start=YYYY-MM-DD --end=YYYY-MM-DD
# → /tmp/bb-forensics/brightboard-backup-YYYY-MM-DD.json
```

---

## 2. 被害カード特定

`scripts/forensics-detect-victims-v2.mjs` の `dates` / `pairs` を編集して走らせる:

```js
const dates = ['2026-XX-YY', '2026-XX-ZZ']; // 検査対象の日次バックアップ
const pairs = [
  ['2026-XX-YY', '2026-XX-ZZ'],
  ['2026-XX-ZZ', 'current'],
];
```

```bash
node scripts/forensics-detect-victims-v2.mjs
# → /tmp/bb-forensics/victims-report.json（被害ID一覧）
```

検出条件: `aStatus !== 'unscheduled' && bStatus === 'unscheduled' && bHist.length === 0`。

---

## 3. 時刻確認

被害IDの `updatedAt` を確認し、ユーザー報告時刻と一致するかチェック。一斉 silent-move は秒オーダーで集中する。

```bash
node scripts/_audit-recent.mjs <task-id>
# または Firestore Console で直接確認
```

---

## 4. 復旧スクリプト作成

`scripts/restore-silent-move-template.mjs` をコピーして `restore-YYYY-MM-DD-HHMM.mjs` を作る:

- `VICTIM_IDS`: ステップ2の出力をリスト化
- `BACKUP_PATH`: 事故前の直近バックアップ
- 復元フィールドは `status / statusEnteredAt / statusHistory` のみ

---

## 5. dry-run → execute

```bash
GOOGLE_CLOUD_PROJECT=brightboard-4595a node scripts/restore-YYYY-MM-DD-HHMM.mjs
# dry-run（書き込みなし、planを表示）

GOOGLE_CLOUD_PROJECT=brightboard-4595a node scripts/restore-YYYY-MM-DD-HHMM.mjs --execute
# 対話確認後、batch write 実行
```

---

## 6. 検証

```bash
GOOGLE_CLOUD_PROJECT=brightboard-4595a node scripts/_fetch-current-tmp.mjs
# 再フェッチ → 全件 status !== 'unscheduled' を確認
```

被害ユーザーへ復旧連絡。インシデント記録を `.company/incidents/YYYY-MM-DD-bb-*.md` に残す。

---

## 既知の真因と恒久対策

| 真因 | 対策 commit |
|---|---|
| NFC sessionStorage 残留で未割当カード上書き | `9108f60` URLクリーンアップで hash 温存 |
| バインダーハッシュ復元時の `NFC_PENDING_KEY` 残留 | `18c47a6` バインダーハッシュでは復元せずクリア |
| iPhone Chrome 古いJSキャッシュ配信 | `381a55c` `.htaccess` で index.html=no-cache / assets=immutable |
| 予約補完 useEffect の不完全 stub | `8e50afc` 補完 useEffect 撤去 |
| 補完バグ再発の防御層欠如 | `e49461d` 監査ログ / `e7d34b6` 中央ガード（field_wipe/loaner_invariant） |

## 関連ファイル

- `scripts/_fetch-current-tmp.mjs` 最新スナップショット
- `scripts/forensics-download-range.mjs` 日次バックアップ取得
- `scripts/forensics-detect-victims-v2.mjs` 被害検出
- `scripts/restore-silent-move-template.mjs` 復旧テンプレ
- `scripts/_audit-recent.mjs` 監査ログ確認
- `src/firebase.js:284-` 中央ガード実装
