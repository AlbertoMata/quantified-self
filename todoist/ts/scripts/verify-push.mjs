// Verify that a pushed Apps Script project actually matches what we staged.
//
// WHY THIS EXISTS: `clasp push` exits 0 when it skips. If the remote manifest
// differs from the local one by so much as a trailing newline, clasp prompts —
// and with no TTY to answer, it declines and skips THE ENTIRE PUSH, printing
// "Skipping push." and returning success. A chained `stage && push` then reports
// a clean deploy having changed nothing. That happened for real on the first
// push:sync, and it is invisible unless you go and look.
//
// So the exit code is not proof. Re-reading the remote is proof. This script
// does the re-read that was previously done by hand after every push.
//
// HOW IT READS THE REMOTE: `clasp pull`, into a throwaway directory — never the
// working tree, and never dist/, because pull OVERWRITES its srcDir and would
// happily replace the very payload we are trying to compare against. clasp
// refuses a srcDir that escapes its config's own directory, so the temporary
// config is written inside the temporary directory with srcDir ".".
//
// Usage:  node scripts/verify-push.mjs <project>   (project: sync | log)

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(workspaceDir, "..", "..");

const PROJECTS = ["sync", "log"];

function fail(message) {
	console.error(`\nverify-push: ${message}\n`);
	process.exit(1);
}

const projectName = process.argv[2];
if (!projectName || !PROJECTS.includes(projectName)) {
	fail(
		`pass a project name: ${PROJECTS.join(" | ")}\n` +
			`  e.g. node scripts/verify-push.mjs sync`,
	);
}

const claspConfigPath = join(workspaceDir, `.clasp-${projectName}.json`);
if (!existsSync(claspConfigPath)) {
	fail(
		`no ${`.clasp-${projectName}.json`} — nothing has been pushed from here.\n` +
			`  Copy .clasp.example.json to it and fill in scriptId (it is gitignored).`,
	);
}

const claspConfig = JSON.parse(readFileSync(claspConfigPath, "utf8"));
const stagedDir = resolve(
	workspaceDir,
	claspConfig.srcDir ?? claspConfig.rootDir ?? ".",
);

if (!existsSync(stagedDir)) {
	fail(
		`nothing staged at ${stagedDir.replace(repoRoot + "/", "")} — run stage:${projectName} first`,
	);
}

// Apps Script stores one source per file with a type, not a filename extension.
// We stage SERVER_JS as .gs; clasp pull writes it back as .js. Comparing by the
// name WITHOUT its extension is therefore the only honest comparison — a file
// is "the same file" to Apps Script regardless of which of the two we used.
const stripExtension = (fileName) =>
	fileName.replace(/\.(gs|js|json|html)$/, "");

function readDirectoryAsMap(directory) {
	const contents = new Map();
	for (const fileName of readdirSync(directory)) {
		if (fileName.startsWith(".")) continue; // the temp clasp config
		contents.set(
			stripExtension(fileName),
			readFileSync(join(directory, fileName), "utf8"),
		);
	}
	return contents;
}

// pwd -P: on macOS the system temp directory is reached through a symlink
// (/var -> /private/var), and clasp refuses a symlinked content directory
// outright ("Possible race attack"). Resolve it before handing it over.
const scratchDir = realpathSync(
	mkdtempSync(join(tmpdir(), `verify-${projectName}-`)),
);
const scratchConfigPath = join(scratchDir, ".clasp-verify.json");

try {
	writeFileSync(
		scratchConfigPath,
		JSON.stringify({ scriptId: claspConfig.scriptId, srcDir: "." }),
	);

	const pull = spawnSync("clasp", ["-P", scratchConfigPath, "pull"], {
		cwd: workspaceDir,
		encoding: "utf8",
		shell: false,
	});

	if (pull.error || pull.status !== 0) {
		fail(
			`clasp pull failed, so the remote could not be read.\n` +
				`  ${(pull.stderr || pull.stdout || pull.error?.message || "").trim()}\n\n` +
				`  If this is an auth problem, run: npm run clasp:login`,
		);
	}

	const staged = readDirectoryAsMap(stagedDir);
	const remote = readDirectoryAsMap(scratchDir);

	const matching = [];
	const differing = [];
	const missingOnRemote = [];

	for (const [name, stagedContent] of staged) {
		if (!remote.has(name)) {
			missingOnRemote.push(name);
		} else if (remote.get(name) === stagedContent) {
			matching.push(name);
		} else {
			differing.push(name);
		}
	}

	// Files the remote has that we did not stage. A push replaces the whole
	// project, so after a successful push there should be none — one here means
	// the push did not land, or someone added a file in the editor.
	const staleOnRemote = [...remote.keys()].filter(
		(name) => !staged.has(name),
	);

	const relativeStaged = stagedDir.replace(repoRoot + "/", "");
	console.log(`\nverify ${projectName}: remote vs ${relativeStaged}`);
	console.log(`  ${matching.length}/${staged.size} files match`);

	for (const name of differing) {
		const stagedContent = staged.get(name);
		const remoteContent = remote.get(name);
		console.log(
			`  DIFFERS   ${name}  (staged ${stagedContent.length}b, remote ${remoteContent.length}b)`,
		);
	}
	for (const name of missingOnRemote)
		console.log(
			`  MISSING   ${name} — staged but not on the remote`,
		);
	for (const name of staleOnRemote)
		console.log(
			`  STALE     ${name} — on the remote but not staged`,
		);

	const problems =
		differing.length +
		missingOnRemote.length +
		staleOnRemote.length;
	if (problems > 0) {
		console.error(
			`\nverify-push: the remote does NOT match ${relativeStaged}.\n\n` +
				`  The most likely cause is a push that printed "Skipping push." and exited 0 —\n` +
				`  clasp does that when the remote manifest differs from the local one and there\n` +
				`  is no TTY to answer its prompt. Check appsscript.json first: a single trailing\n` +
				`  newline is enough. Do NOT reach for --force, which would also silence a real\n` +
				`  OAuth-scope or Web App access change.\n`,
		);
		process.exit(1);
	}

	console.log(`  no stale files on the remote`);
	console.log(
		`\nverify ${projectName}: OK — the remote is exactly what was staged.\n`,
	);
} finally {
	rmSync(scratchDir, { recursive: true, force: true });
}
