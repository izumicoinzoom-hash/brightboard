/**
 * 工程管理アプリ - カード作成時のスプレッドシート連携
 * アプリから POST されたカードデータを「カード履歴」シートに1行追加します。
 *
 * 【設定】下の SPREADSHEET_ID と SHEET_NAME を書き換えてからデプロイしてください。
 */

// ★ カード記録用スプレッドシートのID（URLの /d/ と /edit の間の部分）
var SPREADSHEET_ID = "ここにスプレッドシートIDを貼り付け";

// ★ データを書き込むシート名（例: カード履歴）
var SHEET_NAME = "カード履歴";

/**
 * POST で送られてきた JSON をパースしてシートに1行追加する
 * アプリからは Content-Type: application/json で POST される想定
 */
function doPost(e) {
  var result = { success: false, message: "" };
  try {
    if (!e || !e.postData || !e.postData.contents) {
      result.message = "POSTデータがありません";
      return createJsonResponse(result, 400);
    }
    var json = JSON.parse(e.postData.contents);
    appendCardToSheet(json);
    result.success = true;
    result.message = "登録しました";
    return createJsonResponse(result, 200);
  } catch (err) {
    result.message = "エラー: " + err.toString();
    return createJsonResponse(result, 500);
  }
}

/**
 * GET は CORS プリフライトや動作確認用に 200 を返す
 */
function doGet(e) {
  return createJsonResponse({ success: true, message: "kotei_sheet_sync is running" }, 200);
}

/**
 * JSON レスポンス用の TextOutput を返す（CORS ヘッダ付き）
 */
function createJsonResponse(obj, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * カードデータをシートに1行追加する
 * 列順: 作成日時, カードID, ステータス, メーカー, モデル, 車番, 顧客名, 入庫日, 納車日, 代車種別, 受付担当, 鈑金担当, 塗装担当, カード色, 説明
 */
function appendCardToSheet(data) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error("シート「" + SHEET_NAME + "」が見つかりません。スプレッドシートに「" + SHEET_NAME + "」という名前のシートを作成してください。");
  }

  var now = Utilities.formatDate(new Date(), "JST", "yyyy/MM/dd HH:mm:ss");
  var loanerLabel = (data.loanerType === "none" || !data.loanerType) ? "なし" :
    (data.loanerType === "loaner_k") ? "代車(軽)" :
    (data.loanerType === "loaner_n") ? "代車(普通)" :
    (data.loanerType === "rental") ? "レンタカー" : (data.loanerType || "");

  var row = [
    now,
    data.id || "",
    data.status || "",
    data.maker || "",
    data.car || "",
    data.number || "",
    data.assignee || "",
    data.inDate || "",
    data.outDate || "",
    loanerLabel,
    data.receptionStaff || "",
    data.bodyStaff || "",
    data.paintStaff || "",
    data.color || "",
    data.description || ""
  ];

  sheet.appendRow(row);
}
