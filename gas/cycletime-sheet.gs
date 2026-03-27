/**
 * BrightBoard サイクルタイム記録 - Google Apps Script
 *
 * デプロイ手順:
 * 1. Google スプレッドシートを新規作成
 * 2. 拡張機能 → Apps Script
 * 3. このコードを貼り付け
 * 4. デプロイ → 新しいデプロイ → ウェブアプリ → アクセス: 全員 → デプロイ
 * 5. 表示されたURLを .env の VITE_CYCLETIME_SHEET_URL に設定
 */

// 清田自動車の休日判定
function isHoliday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=日, 6=土

  // 日曜日は休み
  if (day === 0) return true;

  // 第1・第3土曜日は休み（第2・第4・第5土曜は営業）
  if (day === 6) {
    const weekOfMonth = Math.ceil(d.getDate() / 7);
    if (weekOfMonth === 1 || weekOfMonth === 3) return true;
  }

  // 祝日判定
  if (isNationalHoliday(d)) return true;

  return false;
}

// 日本の祝日判定（2026年版 + 汎用ルール）
function isNationalHoliday(d) {
  const m = d.getMonth() + 1; // 1-12
  const day = d.getDate();
  const dow = d.getDay();

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

  // ハッピーマンデー（第2月曜）
  if (dow === 1) {
    const weekOfMonth = Math.ceil(day / 7);
    if (m === 1 && weekOfMonth === 2) return true;   // 成人の日
    if (m === 7 && weekOfMonth === 3) return true;   // 海の日
    if (m === 9 && weekOfMonth === 3) return true;   // 敬老の日
    if (m === 10 && weekOfMonth === 2) return true;  // スポーツの日
  }

  // 春分・秋分（概算）
  if (m === 3 && day >= 20 && day <= 21) return true;
  if (m === 9 && day >= 22 && day <= 23) return true;

  // 振替休日: 祝日が日曜の場合、翌月曜が休み（簡易判定）
  // ※完全な振替休日判定は複雑なため、会社休日シートでの手動追加を推奨

  return false;
}

// 会社休日シートからの追加休日取得
function getCompanyHolidays() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('会社休日');
  if (!sheet) return new Set();

  const data = sheet.getDataRange().getValues();
  const holidays = new Set();
  for (let i = 1; i < data.length; i++) { // ヘッダー行をスキップ
    const dateVal = data[i][0];
    if (dateVal instanceof Date) {
      holidays.add(Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy-MM-dd'));
    }
  }
  return holidays;
}

// 営業日数を計算
function countBusinessDays(startIso, endIso) {
  if (!startIso || !endIso) return 0;

  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;

  // 同日の場合は0.5日
  const startDate = Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy-MM-dd');
  const endDate = Utilities.formatDate(end, 'Asia/Tokyo', 'yyyy-MM-dd');
  if (startDate === endDate) return 0.5;

  const companyHolidays = getCompanyHolidays();
  let count = 0;
  const current = new Date(startDate + 'T00:00:00+09:00');
  const endDt = new Date(endDate + 'T00:00:00+09:00');

  while (current < endDt) {
    const dateStr = Utilities.formatDate(current, 'Asia/Tokyo', 'yyyy-MM-dd');
    if (!isHoliday(current) && !companyHolidays.has(dateStr)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return Math.max(count, 0.5); // 最低0.5日
}

// カレンダー日数を計算
function countCalendarDays(startIso, endIso) {
  if (!startIso || !endIso) return 0;

  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;

  const startDate = Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy-MM-dd');
  const endDate = Utilities.formatDate(end, 'Asia/Tokyo', 'yyyy-MM-dd');
  if (startDate === endDate) return 0.5;

  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  return Math.max(days, 0.5);
}

// メイン工程のステータス順序
var MAIN_STAGES = [
  { status: 'received', label: '入庫済み' },
  { status: 'b_wait', label: 'B待ち' },
  { status: 'b_doing', label: 'B中' },
  { status: 'b_done_p_wait', label: 'B完了P待ち' },
  { status: 'p_only', label: 'Pのみ' },
  { status: 'prep', label: '下処理' },
  { status: 'prep_done', label: '下処理済P待ち' },
  { status: 'prep_p', label: '下処理&塗装' },
  { status: 'painting', label: '塗装' },
  { status: 'assembly_wait', label: '組付け待ち' },
  { status: 'assembly', label: '組付け' },
  { status: 'polish', label: '磨き' },
  { status: 'polishing', label: '磨き中' },
  { status: 'completed', label: '作業完了' },
  { status: 'delivery_wait', label: '納車待ち' },
  { status: 'delivery_today', label: '本日納車' },
  { status: 'delivered_unpaid', label: '納車済-支払待ち' },
  { status: 'delivered_paid', label: '納車済-支払済' },
];

// 集約する工程グループ（スプレッドシートの列にする）
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

// statusHistoryから各工程の滞在時間を計算
function calcStageDurations(task) {
  var hist = task.statusHistory || [];
  var durations = {}; // status -> { totalCalendar: days, totalBusiness: days }

  for (var i = 0; i < hist.length; i++) {
    var entry = hist[i];
    if (!entry || !entry.status || !entry.enteredAt || !entry.exitedAt) continue;

    var cal = countCalendarDays(entry.enteredAt, entry.exitedAt);
    var biz = countBusinessDays(entry.enteredAt, entry.exitedAt);

    if (!durations[entry.status]) {
      durations[entry.status] = { calendar: 0, business: 0 };
    }
    durations[entry.status].calendar += cal;
    durations[entry.status].business += biz;
  }

  // 現在のステータスの滞在時間も追加
  if (task.status && task.statusEnteredAt) {
    var nowIso = new Date().toISOString();
    var cal = countCalendarDays(task.statusEnteredAt, nowIso);
    var biz = countBusinessDays(task.statusEnteredAt, nowIso);
    if (!durations[task.status]) {
      durations[task.status] = { calendar: 0, business: 0 };
    }
    durations[task.status].calendar += cal;
    durations[task.status].business += biz;
  }

  // グループ集約
  var grouped = {};
  for (var g = 0; g < STAGE_GROUPS.length; g++) {
    var group = STAGE_GROUPS[g];
    var calTotal = 0;
    var bizTotal = 0;
    for (var s = 0; s < group.statuses.length; s++) {
      var d = durations[group.statuses[s]];
      if (d) {
        calTotal += d.calendar;
        bizTotal += d.business;
      }
    }
    grouped[group.label] = { calendar: calTotal, business: bizTotal };
  }

  return grouped;
}

// POSTリクエストのハンドラ
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var task = data;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('サイクルタイム');

    // シートがなければ作成
    if (!sheet) {
      sheet = ss.insertSheet('サイクルタイム');
      // ヘッダー行
      var headers = [
        '記録日時', 'カードID', '顧客名', '車種', 'ナンバー',
        '入庫日', '納車日',
        '入庫済み(暦)', '入庫済み(営)',
        'B待ち(暦)', 'B待ち(営)',
        'B中(暦)', 'B中(営)',
        'B完了P待ち(暦)', 'B完了P待ち(営)',
        '塗装工程(暦)', '塗装工程(営)',
        '組付け(暦)', '組付け(営)',
        '磨き(暦)', '磨き(営)',
        '納車工程(暦)', '納車工程(営)',
        '合計(暦日)', '合計(営業日)'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    // 会社休日シートがなければテンプレート作成
    var holidaySheet = ss.getSheetByName('会社休日');
    if (!holidaySheet) {
      holidaySheet = ss.insertSheet('会社休日');
      holidaySheet.appendRow(['日付', '説明']);
      holidaySheet.getRange(1, 1, 1, 2).setFontWeight('bold');
      // GW・お盆・年末年始のサンプル（2026年）
      holidaySheet.appendRow([new Date(2026, 4, 6), 'GW（会社休日）']); // 5/6
      holidaySheet.appendRow([new Date(2026, 7, 13), 'お盆']); // 8/13
      holidaySheet.appendRow([new Date(2026, 7, 14), 'お盆']); // 8/14
      holidaySheet.appendRow([new Date(2026, 7, 15), 'お盆']); // 8/15
      holidaySheet.appendRow([new Date(2026, 11, 29), '年末休み']); // 12/29
      holidaySheet.appendRow([new Date(2026, 11, 30), '年末休み']); // 12/30
      holidaySheet.appendRow([new Date(2026, 11, 31), '年末休み']); // 12/31
      holidaySheet.setFrozenRows(1);
    }

    // 工程別滞在日数を計算
    var durations = calcStageDurations(task);

    // 合計計算
    var totalCal = 0;
    var totalBiz = 0;
    for (var g = 0; g < STAGE_GROUPS.length; g++) {
      var d = durations[STAGE_GROUPS[g].label] || { calendar: 0, business: 0 };
      totalCal += d.calendar;
      totalBiz += d.business;
    }

    // 日数フォーマット（0は空文字、0.5以上は小数点1桁）
    function fmt(val) {
      if (!val || val === 0) return '';
      return Math.round(val * 10) / 10;
    }

    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

    var row = [
      now,
      task.id || '',
      task.assignee || '',
      task.car || '',
      task.number || '',
      task.inDate || '',
      task.outDate || '',
    ];

    // 各グループの暦日・営業日を追加
    for (var g = 0; g < STAGE_GROUPS.length; g++) {
      var d = durations[STAGE_GROUPS[g].label] || { calendar: 0, business: 0 };
      row.push(fmt(d.calendar));
      row.push(fmt(d.business));
    }

    row.push(fmt(totalCal));
    row.push(fmt(totalBiz));

    // 重複チェック（同じカードIDの既存行を更新）
    var dataRange = sheet.getDataRange();
    var values = dataRange.getValues();
    var existingRow = -1;
    for (var i = 1; i < values.length; i++) {
      if (values[i][1] === task.id) {
        existingRow = i + 1; // 1-indexed
        break;
      }
    }

    if (existingRow > 0) {
      // 既存行を更新
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      // 新規行を追加
      sheet.appendRow(row);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// GETリクエスト（テスト用）
function doGet(e) {
  return ContentService.createTextOutput('BrightBoard Cycle Time Sheet API is running.')
    .setMimeType(ContentService.MimeType.TEXT);
}
