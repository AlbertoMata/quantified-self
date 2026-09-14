// ─────────────────────────────────────────────────────────────────────────────
// The event-log webhook — the port's only INBOUND path
//
// Apple Shortcuts POST here from a watch face and a Siri phrase. Everything else
// in this project is scheduled and can be retried; this is a request from a
// device that will not retry, so the shape is different in two ways:
//
//   1. It NEVER THROWS. A thrown error reaches a Shortcut as an opaque failure
//      the phone shows no useful message for, and the event is simply lost. It
//      returns a JSON body saying what happened instead.
//   2. It writes ONE row, immediately. There is no plan/apply split because
//      there is nothing to decide — the only question is what the row contains.
//
// ⚠️ THIS WEBHOOK NEVER MOVES TO GITHUB ACTIONS. A scheduled runner has no
// inbound endpoint, so this stays on Apps Script permanently. It is ported for
// consistency of language, not in preparation for a migration.
//
// The parsing is pure and lives here; the Web App entry point is the only thing
// that touches the platform.
// ─────────────────────────────────────────────────────────────────────────────

import type { Row } from "../ports/values.ts";

export const EVENT_LOG_TAB = "Log";

export const EVENT_LOG_HEADER: Row = [
	"timestamp",
	"event_type",
	"value",
	"notes",
	"source",
];

export interface LogEventBody {
	readonly timestamp?: unknown;
	readonly event_type?: unknown;
	readonly value?: unknown;
	readonly notes?: unknown;
	// Some Shortcuts send `note`; both spellings have existed in the wild.
	readonly note?: unknown;
	readonly source?: unknown;
}

// Build the row one POST becomes.
//
// `now` is passed in rather than read, so the fallback timestamp is testable —
// and so a Shortcut that sends its own timestamp (which it should, because the
// watch may be offline when the event happens) is not silently overwritten.
export function buildLogEventRow(body: LogEventBody, now: Date): Row {
	return [
		text(body.timestamp) || now.toISOString(),
		// `custom` rather than blank: an event with no type is still an event,
		// and a blank cell would be invisible in every chart.
		text(body.event_type) || "custom",
		text(body.value),
		// Both spellings accepted. `notes` wins when both are present.
		text(body.notes) || text(body.note),
		// `shortcut` is the honest default — nothing else posts here today.
		text(body.source) || "shortcut",
	];
}

function text(value: unknown): string {
	if (value === null || value === undefined) return "";
	return String(value);
}

export interface WebhookResult {
	readonly status: "ok" | "error";
	readonly body: string;
}

export function okResponse(): WebhookResult {
	return { status: "ok", body: JSON.stringify({ status: "ok" }) };
}

export function errorResponse(error: unknown): WebhookResult {
	return {
		status: "error",
		body: JSON.stringify({
			status: "error",
			message:
				error instanceof Error
					? error.message
					: String(error),
		}),
	};
}

export function aliveResponse(): WebhookResult {
	return { status: "ok", body: JSON.stringify({ status: "alive" }) };
}

// Parse a POST body, reporting WHY it failed rather than throwing.
//
// A Shortcut that sends malformed JSON gets a message it can be debugged with,
// and the webhook stays up for the next event.
export function parseLogEventBody(raw: unknown): LogEventBody {
	if (typeof raw !== "string" || raw.trim() === "") {
		throw new Error("empty request body");
	}
	const parsed: unknown = JSON.parse(raw);
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed)
	) {
		throw new Error("body must be a JSON object");
	}
	return parsed as LogEventBody;
}
