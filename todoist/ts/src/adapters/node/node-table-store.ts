// TableStore over the Sheets API — NOT YET IMPLEMENTED (F2).
//
// The shape is already settled by the port interface, and deliberately so: it
// is row-oriented with no A1 notation, which maps onto the Sheets API's
// values.get / values.update / values.append about as directly as it maps onto
// SpreadsheetApp.
//
// Two things will need care when this is written:
//
//   * `clearRowsFrom` is values.clear over a range, NOT a deleteDimension
//     request. The distinction is the same one that bit the legacy code — the
//     applier then writes straight back on top of the cleared rows, and a
//     delete would shift everything underneath.
//
//   * A service account sees a Date as a serial number unless the request asks
//     for `valueRenderOption: UNFORMATTED_VALUE` with
//     `dateTimeRenderOption: FORMATTED_STRING`, or converts the serial itself.
//     CellValue admits a Date because that is what the sheet holds; this
//     adapter has to honour that rather than hand every date back as 46000.

import type { TableStore } from "../../ports/table-store.ts";
import { notImplemented } from "./not-implemented.ts";

export function createNodeTableStore(): TableStore {
	return {
		readRows: () => notImplemented("TableStore.readRows", "F2"),
		hasTable: () => notImplemented("TableStore.hasTable", "F2"),
		ensureTable: () =>
			notImplemented("TableStore.ensureTable", "F2"),
		appendRows: () => notImplemented("TableStore.appendRows", "F2"),
		writeRows: () => notImplemented("TableStore.writeRows", "F2"),
		deleteRows: () => notImplemented("TableStore.deleteRows", "F2"),
		clearRowsFrom: () =>
			notImplemented("TableStore.clearRowsFrom", "F2"),
	};
}
