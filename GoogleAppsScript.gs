// こんだてマン - Google Apps Script
// デプロイ設定:
//   次のユーザーとして実行: 自分
//   アクセスできるユーザー: Googleアカウントを持つ全員

const SHEET_NAME = "data";
const TOKEN_KEY = "token"; // 認証トークン（任意）

function doGet(e) {
  try {
    const token = e.parameter[TOKEN_KEY] || "";
    if (!checkToken(token)) {
      return jsonResponse({ error: "Unauthorized" });
    }

    const sheet = getSheet();
    const raw = sheet.getRange("A1").getValue();
    if (!raw) return jsonResponse({ data: null });

    const data = JSON.parse(raw);
    return jsonResponse({ data });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const token = body[TOKEN_KEY] || "";

    if (!checkToken(token)) {
      return jsonResponse({ error: "Unauthorized" });
    }

    const sheet = getSheet();
    sheet.getRange("A1").setValue(JSON.stringify(body.data));
    sheet.getRange("B1").setValue(new Date().toISOString());

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function checkToken(token) {
  // トークンが設定されていない場合は認証なし（誰でもアクセス可）
  const scriptToken = PropertiesService.getScriptProperties().getProperty(TOKEN_KEY);
  if (!scriptToken) return true;
  return token === scriptToken;
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  return sheet;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
