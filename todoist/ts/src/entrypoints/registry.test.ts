import assert from "node:assert/strict";
import { test } from "node:test";

import { entryPoints, globalNameFor } from "./registry.ts";

test("every generated global carries the port prefix", () => {
	// The prefix is the only thing keeping the port's globals clear of the ten
	// legacy files sharing this project's one flat scope. Without it, a second
	// definition of syncTodoist silently wins and the nightly trigger runs it.
	for (const entryPoint of entryPoints) {
		assert.match(
			globalNameFor(entryPoint),
			/^port[A-Z]/,
			`${entryPoint.name} must generate a port-prefixed global`,
		);
	}
});

test("no two entry points generate the same global", () => {
	// A duplicate here is not an error at runtime — the last one concatenated
	// wins, silently. The build throws on this too; this catches it a step
	// earlier, without needing a build.
	const names = entryPoints.map(globalNameFor);
	assert.equal(new Set(names).size, names.length);
});

test("no entry point reuses a legacy global name", () => {
	// The eleven names the port eventually wants all exist already in the live
	// project. Even prefixed, it is worth asserting the raw collision cannot
	// reappear through a stray hand-written name.
	const legacyGlobals = new Set([
		"syncTodoist",
		"syncTodoistIntraday",
		"checkBillRisk",
		"syncOverdue",
		"syncCompletions",
		"syncHabitDaily",
		"syncAreaDaily",
		"syncTaskDaily",
		"syncBillCycle",
		"syncKarmaStats",
		"syncRecurringStatus",
	]);
	for (const entryPoint of entryPoints) {
		assert.equal(
			legacyGlobals.has(globalNameFor(entryPoint)),
			false,
			`${globalNameFor(entryPoint)} collides with a live legacy global`,
		);
	}
});

test("globalNameFor capitalises exactly one letter", () => {
	assert.equal(globalNameFor({ name: "ping" }), "portPing");
	assert.equal(globalNameFor({ name: "syncTodoist" }), "portSyncTodoist");
});

test("a trigger declares when it runs; other kinds need not", () => {
	// A trigger with no schedule is one nobody can reason about from the
	// registry, which is the whole point of having one.
	for (const entryPoint of entryPoints) {
		if (entryPoint.kind === "trigger") {
			assert.ok(
				entryPoint.schedule,
				`${entryPoint.name} is a trigger and must declare a schedule`,
			);
		}
	}
});

test("every entry point has a summary worth reading", () => {
	for (const entryPoint of entryPoints) {
		assert.ok(
			entryPoint.summary.length > 10,
			`${entryPoint.name} needs a real summary — it becomes the comment above the generated global`,
		);
	}
});
