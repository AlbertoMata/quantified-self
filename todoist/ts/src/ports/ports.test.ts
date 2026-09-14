// A port that typechecks is not the same as a port something can implement.
// These fakes are the cheapest proof that the seam is satisfiable without any
// platform at all — no Google global, no network, no clock — which is the
// property every test in Phases C and D depends on.
//
// They are also the fakes those phases will reuse, so they are written to be
// inspectable: the table store keeps its tabs in a Map you can read back, and
// the clock records what it was asked to sleep for rather than sleeping.

import assert from "node:assert/strict";
import { test } from "node:test";

import type {
	CacheStore,
	Clock,
	HttpResponse,
	HttpTransport,
	IdGenerator,
	KeyValueStore,
	Logger,
	Row,
	Runtime,
	TableName,
	TableStore,
} from "./index.ts";

class FakeHttpTransport implements HttpTransport {
	readonly requests: string[] = [];
	// Written out rather than a constructor parameter property: those generate
	// code, so erasableSyntaxOnly rejects them and Node's type stripping could
	// not run this file.
	private readonly response: HttpResponse;
	constructor(response: HttpResponse) {
		this.response = response;
	}
	get(url: string): HttpResponse {
		this.requests.push(`GET ${url}`);
		return this.response;
	}
	post(url: string): HttpResponse {
		this.requests.push(`POST ${url}`);
		return this.response;
	}
}

class FakeTableStore implements TableStore {
	readonly tabs = new Map<TableName, Row[]>();
	readRows(tab: TableName): Row[] {
		return [...(this.tabs.get(tab) ?? [])];
	}
	hasTable(tab: TableName): boolean {
		return this.tabs.has(tab);
	}
	ensureTable(tab: TableName, header: Row): void {
		if (!this.tabs.has(tab)) this.tabs.set(tab, [header]);
	}
	appendRows(tab: TableName, rows: readonly Row[]): void {
		this.tabs.set(tab, [...(this.tabs.get(tab) ?? []), ...rows]);
	}
	writeRows(
		tab: TableName,
		firstRow: number,
		rows: readonly Row[],
	): void {
		const existing = [...(this.tabs.get(tab) ?? [])];
		rows.forEach((row, offset) => {
			existing[firstRow - 1 + offset] = row;
		});
		this.tabs.set(tab, existing);
	}
	deleteRows(tab: TableName, firstRow: number, count: number): void {
		const existing = [...(this.tabs.get(tab) ?? [])];
		existing.splice(firstRow - 1, count);
		this.tabs.set(tab, existing);
	}
	clearRowsFrom(tab: TableName, firstRow: number): void {
		// Real Sheets blanks the cells and leaves the rows; truncating models
		// the same end state for a tail clear, which is the only shape the
		// resolver ever produces.
		this.tabs.set(
			tab,
			[...(this.tabs.get(tab) ?? [])].slice(0, firstRow - 1),
		);
	}
}

class FakeKeyValueStore implements KeyValueStore {
	readonly values = new Map<string, string>();
	read(key: string): string | null {
		return this.values.get(key) ?? null;
	}
	write(key: string, value: string): void {
		this.values.set(key, value);
	}
}

class FakeCacheStore implements CacheStore {
	readonly values = new Map<string, string>();
	read(key: string): string | null {
		return this.values.get(key) ?? null;
	}
	write(key: string, value: string): void {
		this.values.set(key, value);
	}
}

class FakeClock implements Clock {
	readonly sleeps: number[] = [];
	private readonly instant: Date;
	constructor(instant: Date) {
		this.instant = instant;
	}
	now(): Date {
		return this.instant;
	}
	sleep(milliseconds: number): void {
		this.sleeps.push(milliseconds); // recorded, never actually waited
	}
}

class FakeLogger implements Logger {
	readonly lines: string[] = [];
	log(message: string): void {
		this.lines.push(message);
	}
}

class FakeIdGenerator implements IdGenerator {
	private counter = 0;
	newUuid(): string {
		this.counter += 1;
		return `uuid-${this.counter}`;
	}
}

function createFakeRuntime(): Runtime {
	return {
		http: new FakeHttpTransport({ status: 200, body: "{}" }),
		tables: new FakeTableStore(),
		state: new FakeKeyValueStore(),
		cache: new FakeCacheStore(),
		clock: new FakeClock(new Date("2026-09-14T05:30:00Z")),
		logger: new FakeLogger(),
		ids: new FakeIdGenerator(),
		settings: (key) =>
			key === "TODOIST_TOKEN" ? "fake-token" : null,
	};
}

test("every port is implementable without a platform", () => {
	const runtime = createFakeRuntime();
	assert.equal(
		runtime.clock.now().toISOString(),
		"2026-09-14T05:30:00.000Z",
	);
	assert.equal(runtime.state.read("PORT_TODOIST_LAST_SYNC"), null);
	assert.equal(runtime.ids.newUuid(), "uuid-1");
	assert.equal(runtime.ids.newUuid(), "uuid-2", "uuids must not repeat");
});

test("a non-2xx response is returned, not thrown", () => {
	// Todoist answers a rate-limit with 429 and a body worth reading. A
	// transport that threw would destroy the body before anyone could look.
	const transport = new FakeHttpTransport({
		status: 429,
		body: '{"error":"rate limited"}',
	});
	const response = transport.get("https://api.todoist.com/rest/v2/tasks");
	assert.equal(response.status, 429);
	assert.match(response.body, /rate limited/);
});

test("a cell holds the types a spreadsheet actually returns", () => {
	// Not everything is a string: a date cell comes back as a Date, an empty
	// one as "". Flattening these to strings is how a date column stops
	// charting in Looker.
	const tables = new FakeTableStore();
	const row: Row = [
		"2026-09-14",
		42,
		true,
		new Date("2026-09-14"),
		null,
		"",
	];
	tables.ensureTable("Overdue_port", ["day", "count"]);
	tables.appendRows("Overdue_port", [row]);

	const written = tables.readRows("Overdue_port")[1];
	assert.ok(written);
	assert.ok(written[3] instanceof Date);
	assert.equal(written[1], 42);
	assert.equal(written[4], null);
});

test("ensureTable is idempotent, so a pipeline can call it every run", () => {
	const tables = new FakeTableStore();
	tables.ensureTable("TaskDaily_port", ["day", "task_id"]);
	tables.appendRows("TaskDaily_port", [["2026-09-14", "abc"]]);
	tables.ensureTable("TaskDaily_port", ["day", "task_id"]);

	assert.equal(
		tables.readRows("TaskDaily_port").length,
		2,
		"a second ensureTable must not wipe the rows already there",
	);
});

test("the clock's sleep is recorded, never waited", () => {
	const clock = new FakeClock(new Date("2026-09-14T05:30:00Z"));
	clock.sleep(300); // the paginator's courtesy delay between pages
	clock.sleep(400); // the completions windower's, between windows
	assert.deepEqual(clock.sleeps, [300, 400]);
});
