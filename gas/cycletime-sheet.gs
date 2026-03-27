/**
 * BrightBoard 統合スプレッドシート連携
 * シート1: 入庫記録（カード作成・入庫済み到達時）
 * シート2: サイクルタイム（納車到達時に工程別滞在日数を記録）
 * シート3: 会社休日（GW・お盆・年末年始等の手動管理）
 *
 * デプロイ手順:
 * 1. Google スプレッドシートを新規作成（名前: 「BrightBoard 工程記録」等）
 * 2. 拡張機能 → Apps Script を開く
 * 3. このコード全体をコピーして貼り付け
 * 4. 保存（Ctrl+S）
 * 5. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」→ アクセス「全員」→ デプロイ
 * 6. 表示されたURLをコピー
 * 7. BrightBoard の .env に以下を追加:
 *    VITE_SHEET_SYNC_URL=（上記URL）
 *    VITE_CYCLETIME_SHEET_URL=（同じURL）
 * 8. npm run build → デプロイ
 */

// ===== 清田自動車の休日判定 =====

function isHoliday(date) {
  var d = new Date(date);
  var day = d.getDay(); // 0=日, 6=土

  // 日曜日は休み
  if (day === 0) return true;

  // 第1・第3土曜日は休み（第2・第4・第5土曜は営業）
  if (day === 6) {
    var weekOfMonth = Math.ceil(d.getDate() / 7);
    if (weekOfMonth === 1 || weekOfMonth === 3) return true;
  }

  // 祝日判定
  if (isNationalHoliday(d)) return true;

  return false;
}

function isNationalHoliday(d) {
  var m = d.getMonth() + 1;
  var day = d.getDate();
  var dow = d.getDay();

  // 固定祝日
  if (m === 1 && day === 1) return true;   // 元日
  if (m === 2 && day === 11) return true;  // 建国記念の日
  if (m === 2 && day === 23) return true;  // 天皇誕生日
  if (m === 4 && day === 29) return true;  // 昭和の日
  if (m === 5 && day === 3) return true;   // 憲法記念日
  if (m === 5 && day === 4) return true;   // みどりの日
  if (m === 5 && day === 5) return true;   // こどもの日
  if (m === 8 && day === 11) return true;  // 山の日
  if (m === 11 && day === 3) return true;  // 文化の日
  if (m === 11 && day === 23) return true; // 勤労感謝の日

  // ハッピーマンデー
  if (dow === 1) {
    var weekOfMonth = Math.ceil(day / 7);
    if (m === 1 && weekOfMonth === 2) return true;   // 成人の日
    if (m === 7 && weekOfMonth === 3) return true;   // 海の日
    if (m === 9 && weekOfMonth === 3) return true;   // 敬老の日
    if (m === 10 && weekOfMonth === 2) return true;  // スポーツの日
  }

  // 春分・秋分（概算）
  if (m === 3 && day >= 20 && day <= 21) return true;
  if (m === 9 && day >= 22 && day <= 23) return true;

  return false;
}

function getCompanyHolidays() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('会社休日');
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var holidays = {};
  for (var i = 1; i < data.length; i++) {
    var dateVal = data[i][0];
    if (dateVal instanceof Date) {
      holidays[Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy-MM-dd')] = true;
    }
  }
  return holidays;
}

// ===== 日数計算 =====

function toJSTDateStr(isoOrDate) {
  var d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

function countCalendarDays(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  var s = toJSTDateStr(startIso);
  var e = toJSTDateStr(endIso);
  if (!s || !e) return 0;
  if (s === e) return 0.5;
  var ms = new Date(e).getTime() - new Date(s).getTime();
  return Math.max(Math.ceil(ms / 86400000), 0.5);
}

function countBusinessDays(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  var s = toJSTDateStr(startIso);
  var e = toJSTDateStr(endIso);
  if (!s || !e) return 0;
  if (s === e) return 0.5;
  var companyHolidays = getCompanyHolidays();
  var count = 0;
  var current = new Date(s + 'T00:00:00+09:00');
  var endDt = new Date(e + 'T00:00:00+09:00');
  while (current < endDt) {
    var dateStr = Utilities.formatDate(current, 'Asia/Tokyo', 'yyyy-MM-dd');
    if (!isHoliday(current) && !companyHolidays[dateStr]) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return Math.max(count, 0.5);
}

// ===== 工程グループ定義 =====

var STAGE_GROUPS = [
  { label: '入庫済み', statuses: ['received'] },
  { label: 'B待ち', statuses: ['b_wait'] },
  { label: 'B中', statuses: ['b_doing'] },
  { label: 'B完了P待ち', statuses: ['b_done_p_wait'] },
  { label: '塗装工程', statuses: ['p_only', 'prep', 'prep_done', 'prep_p', 'painting', 'assembly_wait'] },
  { label: '組付け', statuses: ['assembly'] },
  { label: '磨き', statuses: ['polish', 'polishing'] },
  { label: '納車工程', statuses: ['completed', 'delivery_wait', 'delivery_today'] },
];

function calcStageDurations(task) {
  var hist = task.statusHistory || [];
  var durations = {};
  for (var i = 0; i < hist.length; i++) {
    var entry = hist[i];
    if (!entry || !entry.status || !entry.enteredAt || !entry.exitedAt) continue;
    if (!durations[entry.status]) durations[entry.status] = { calendar: 0, business: 0 };
    durations[entry.status].calendar += countCalendarDays(entry.enteredAt, entry.exitedAt);
    durations[entry.status].business += countBusinessDays(entry.enteredAt, entry.exitedAt);
  }
  if (task.status && task.statusEnteredAt) {
    var nowIso = new Date().toISOString();
    if (!durations[task.status]) durations[task.status] = { calendar: 0, business: 0 };
    durations[task.status].calendar += countCalendarDays(task.statusEnteredAt, nowIso);
    durations[task.status].business += countBusinessDays(task.statusEnteredAt, nowIso);
  }
  var grouped = {};
  for (var g = 0; g < STAGE_GROUPS.length; g++) {
    var group = STAGE_GROUPS[g];
    var cal = 0, biz = 0;
    for (var s = 0; s < group.statuses.length; s++) {
      var d = durations[group.statuses[s]];
      if (d) { cal += d.calendar; biz += d.business; }
    }
    grouped[group.label] = { calendar: cal, business: biz };
  }
  return grouped;
}

function fmt(val) {
  if (!val || val === 0) return '';
  return Math.round(val * 10) / 10;
}

function jstNow() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

// ===== シート初期化 =====

function ensureSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 入庫記録シート
  var checkinSheet = ss.getSheetByName('入庫記録');
  if (!checkinSheet) {
    checkinSheet = ss.insertSheet('入庫記録');
    checkinSheet.appendRow([
      '記録日時', 'カードID', '顧客名', '車種', 'ナンバー', 'メーカー', '色番号',
      '入庫区分', '入庫詳細', '入庫日', '入庫時間', '出庫予定日',
      '受付担当', '鈑金担当', '塗装担当',
      '代車タイプ', '代車ID',
      'ステータス'
    ]);
    checkinSheet.getRange(1, 1, 1, 18).setFontWeight('bold');
    checkinSheet.setFrozenRows(1);
  }

  // サイクルタイムシート
  var cycleSheet = ss.getSheetByName('サイクルタイム');
  if (!cycleSheet) {
    cycleSheet = ss.insertSheet('サイクルタイム');
    var headers = [
      '記録日時', 'カードID', '顧客名', '車種', 'ナンバー',
      '入庫日', '納車日',
    ];
    for (var g = 0; g < STAGE_GROUPS.length; g++) {
      headers.push(STAGE_GROUPS[g].label + '(暦日)');
      headers.push(STAGE_GROUPS[g].label + '(営業日)');
    }
    headers.push('合計(暦日)');
    headers.push('合計(営業日)');
    cycleSheet.appendRow(headers);
    cycleSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    cycleSheet.setFrozenRows(1);
  }

  // 会社休日シート
  var holidaySheet = ss.getSheetByName('会社休日');
  if (!holidaySheet) {
    holidaySheet = ss.insertSheet('会社休日');
    holidaySheet.appendRow(['日付', '説明']);
    holidaySheet.getRange(1, 1, 1, 2).setFontWeight('bold');
    holidaySheet.appendRow([new Date(2026, 4, 6), 'GW（会社休日）']);
    holidaySheet.appendRow([new Date(2026, 7, 13), 'お盆']);
    holidaySheet.appendRow([new Date(2026, 7, 14), 'お盆']);
    holidaySheet.appendRow([new Date(2026, 7, 15), 'お盆']);
    holidaySheet.appendRow([new Date(2026, 11, 29), '年末休み']);
    holidaySheet.appendRow([new Date(2026, 11, 30), '年末休み']);
    holidaySheet.appendRow([new Date(2026, 11, 31), '年末休み']);
    holidaySheet.setFrozenRows(1);
  }

  return { checkin: checkinSheet, cycle: cycleSheet, holiday: holidaySheet };
}

// ===== 入庫記録の書き込み =====

function writeCheckinRecord(task) {
  var sheets = ensureSheets();
  var sheet = sheets.checkin;

  var row = [
    jstNow(),
    task.id || '',
    task.assignee || '',
    task.car || '',
    task.number || '',
    task.maker || '',
    task.colorNo || '',
    task.entryPrimary || '',
    task.entryDetail || '',
    task.inDate || '',
    task.inTime || '',
    task.outDate || '',
    task.receptionStaff || '',
    task.bodyStaff || '',
    task.paintStaff || '',
    task.loanerType || '',
    task.loanerCarId || '',
    task.status || '',
  ];

  // 重複チェック（同じカードIDがあれば更新）
  var data = sheet.getDataRange().getValues();
  var existingRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === task.id) { existingRow = i + 1; break; }
  }
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

// ===== サイクルタイムの書き込み =====

function writeCycleTimeRecord(task) {
  var sheets = ensureSheets();
  var sheet = sheets.cycle;

  var durations = calcStageDurations(task);
  var totalCal = 0, totalBiz = 0;
  for (var g = 0; g < STAGE_GROUPS.length; g++) {
    var d = durations[STAGE_GROUPS[g].label] || { calendar: 0, business: 0 };
    totalCal += d.calendar;
    totalBiz += d.business;
  }

  var row = [
    jstNow(),
    task.id || '',
    task.assignee || '',
    task.car || '',
    task.number || '',
    task.inDate || '',
    task.outDate || '',
  ];
  for (var g = 0; g < STAGE_GROUPS.length; g++) {
    var d = durations[STAGE_GROUPS[g].label] || { calendar: 0, business: 0 };
    row.push(fmt(d.calendar));
    row.push(fmt(d.business));
  }
  row.push(fmt(totalCal));
  row.push(fmt(totalBiz));

  // 重複チェック
  var data = sheet.getDataRange().getValues();
  var existingRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === task.id) { existingRow = i + 1; break; }
  }
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

// ===== POST ハンドラ（メインエントリポイント） =====

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // action フィールドで入庫 or サイクルタイムを区別
    // action が未指定の場合はステータスで自動判定
    var action = data._action || '';

    if (action === 'checkin') {
      writeCheckinRecord(data);
    } else if (action === 'cycletime') {
      writeCycleTimeRecord(data);
    } else {
      // 自動判定: delivered_unpaid/delivered_paid ならサイクルタイム、それ以外は入庫
      var deliveryStatuses = ['delivered_unpaid', 'delivered_paid'];
      if (deliveryStatuses.indexOf(data.status) >= 0) {
        writeCycleTimeRecord(data);
      } else {
        writeCheckinRecord(data);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  ensureSheets();
  return ContentService.createTextOutput('BrightBoard 工程記録API - シート初期化完了')
    .setMimeType(ContentService.MimeType.TEXT);
}
