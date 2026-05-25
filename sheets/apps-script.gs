const SHEET_NAME = "Log";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

    const timestamp = data.timestamp || new Date().toISOString();
    const eventType = data.event_type || "custom";
    const value     = data.value     || "";
    const notes     = data.notes || data.note || "";
    const source    = data.source    || "shortcut";

    sheet.appendRow([timestamp, eventType, value, notes, source]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// GET handler for health checks
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "alive" }))
    .setMimeType(ContentService.MimeType.JSON);
}
