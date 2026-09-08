// Webhook for the "Health Sync" Apple Shortcut → quantified-self-health.
// Bind this to the quantified-self-health spreadsheet (Extensions → Apps Script),
// deploy as its OWN Web App, and paste that URL into the Health Sync shortcut.
// It is separate from apps-script.gs (which is bound to quantified-self-log).

const SHEET_NAME = "Health";

// Column order — must match the header row in schema-health.md.
const COLS = [
	"date",
	"steps",
	"sleep_hours",
	"hrv_ms",
	"resting_hr_bpm",
	"active_calories",
	"stand_hours",
	"workout_minutes",
	"blood_oxygen_pct",
	"noise_exposure_db",
	"mindful_minutes",
	"exported_at",
];

function doPost(e) {
	try {
		const data = JSON.parse(e.postData.contents);
		const sheet =
			SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
				SHEET_NAME,
			);

		// Build the row in column order; missing keys become "".
		const row = COLS.map((c) => (data[c] != null ? data[c] : ""));

		// Upsert by date (column A): overwrite today's row if it exists, else append.
		// Re-running the shortcut for the same day replaces the row instead of duplicating it.
		const lastRow = sheet.getLastRow();
		let matchedRow = -1;
		if (lastRow >= 2) {
			const dates = sheet
				.getRange(2, 1, lastRow - 1, 1)
				.getValues();
			for (let i = 0; i < dates.length; i++) {
				if (String(dates[i][0]) === String(data.date)) {
					matchedRow = i + 2; // +2: skip header, 0-indexed → 1-indexed
					break;
				}
			}
		}

		if (matchedRow > 0) {
			sheet.getRange(matchedRow, 1, 1, COLS.length).setValues(
				[row],
			);
		} else {
			sheet.appendRow(row);
		}

		return ContentService.createTextOutput(
			JSON.stringify({ status: "ok", upserted: data.date }),
		).setMimeType(ContentService.MimeType.JSON);
	} catch (err) {
		return ContentService.createTextOutput(
			JSON.stringify({
				status: "error",
				message: err.toString(),
			}),
		).setMimeType(ContentService.MimeType.JSON);
	}
}

// GET handler for health checks
function doGet(e) {
	return ContentService.createTextOutput(
		JSON.stringify({ status: "alive" }),
	).setMimeType(ContentService.MimeType.JSON);
}
