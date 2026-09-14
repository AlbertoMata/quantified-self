// ─────────────────────────────────────────────────────────────────────────────
// HttpTransport over UrlFetchApp
//
// UrlFetchApp is already synchronous, so this adapter is the easy half of the
// contract — adapters/node/ is the one that has to work for it.
//
// muteHttpExceptions: true on every request, always. Without it UrlFetchApp
// throws on any non-2xx and the response body goes with it — and Todoist
// answers a 429 with a body that says what to do about it. The port's contract
// is that status is data; this is where that is honoured.
// ─────────────────────────────────────────────────────────────────────────────

import type { HttpResponse, HttpTransport } from "../../ports/http.ts";
import type { GasUrlFetchApp } from "./gas-types.ts";

export function createGasHttpTransport(
	urlFetchApp: GasUrlFetchApp,
): HttpTransport {
	return {
		get(url, headers): HttpResponse {
			const response = urlFetchApp.fetch(url, {
				method: "get",
				headers: { ...headers },
				muteHttpExceptions: true,
			});
			return {
				status: response.getResponseCode(),
				body: response.getContentText(),
			};
		},

		post(url, headers, body): HttpResponse {
			const response = urlFetchApp.fetch(url, {
				method: "post",
				// Todoist's /sync endpoint is the only POST target, and it
				// wants JSON. contentType is separate from headers in the
				// UrlFetchApp API; setting it in headers alone is ignored.
				contentType: "application/json",
				headers: { ...headers },
				payload: body,
				muteHttpExceptions: true,
			});
			return {
				status: response.getResponseCode(),
				body: response.getContentText(),
			};
		},
	};
}
