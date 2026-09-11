// Stage the legacy .gs files into dist/<project>/ so clasp can push them.
//
// WHY THIS EXISTS: clasp refuses a srcDir that escapes its config's own
// directory, and it pushes every file it finds there — including .ts. Pointing
// clasp at the working tree would either upload src/**/*.ts or need a
// .claspignore fighting it, and would put appsscript.json in the source tree.
// Staging keeps clasp out of the working tree entirely: it only ever reads
// dist/, which is gitignored and regenerable.
//
// LEGACY STAGES UNBUNDLED — one dist file per .gs file. That keeps the editor
// diffable file-by-file against the repo, which is what made the A3 pull
// trustworthy. Bundling into a single file starts at B4, for ported code only.
//
// Usage:  node scripts/prepare-legacy.mjs <project>   (project: sync | log)

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(workspaceDir, "..", "..");

// One entry per Apps Script project. `manifest` is the appsscript.json that
// ships with the code — never invented, always the one pulled from the live
// project, because for a bound Web App it carries the deployment's access and
// executeAs settings.
const PROJECTS = {
	sync: {
		description: "Quantified Self - Todoist Sync (standalone)",
		sourceDir: join(repoRoot, "todoist", "legacy-implementation"),
		manifest: join(workspaceDir, "appsscript", "todoist.json"),
		claspConfig: ".clasp-sync.json",
	},
	log: {
		description: "quantified-self-log webhook (bound to the spreadsheet)",
		sourceDir: join(repoRoot, "event-log"),
		manifest: join(workspaceDir, "appsscript", "log.json"),
		claspConfig: ".clasp-log.json",
	},
};

function fail(message) {
	console.error(`\nprepare-legacy: ${message}\n`);
	process.exit(1);
}

const projectName = process.argv[2];
if (!projectName || !(projectName in PROJECTS)) {
	fail(
		`pass a project name: ${Object.keys(PROJECTS).join(" | ")}\n` +
			`  e.g. node scripts/prepare-legacy.mjs sync`,
	);
}

const project = PROJECTS[projectName];

if (!existsSync(project.manifest)) {
	fail(
		`no manifest at ${project.manifest.replace(repoRoot + "/", "")}\n\n` +
			`  A manifest is required — clasp will not push without one, and it must be\n` +
			`  the REAL one from the live project. Do not write it by hand: for a bound\n` +
			`  Web App, appsscript.json carries the deployment's access and executeAs\n` +
			`  settings, and pushing a guessed manifest can change who may call the\n` +
			`  webhook, or break the URL the Shortcuts already point at.\n\n` +
			`  To capture it: get the Script ID from the spreadsheet\n` +
			`  (Extensions -> Apps Script -> Project Settings), clasp pull it into a\n` +
			`  scratch directory, and copy its appsscript.json here.`,
	);
}

const sourceFiles = readdirSync(project.sourceDir)
	.filter((name) => name.endsWith(".gs"))
	.sort();

if (sourceFiles.length === 0) {
	fail(`no .gs files found in ${project.sourceDir.replace(repoRoot + "/", "")}`);
}

// dist/ is regenerable and gitignored, so a clean rebuild is always safe —
// and it is the only way a file deleted from the repo also leaves the push.
const outputDir = join(workspaceDir, "dist", projectName);
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

let totalBytes = 0;
for (const fileName of sourceFiles) {
	const contents = readFileSync(join(project.sourceDir, fileName));
	writeFileSync(join(outputDir, fileName), contents);
	totalBytes += contents.length;
}

// clasp expects the manifest to be named appsscript.json inside srcDir,
// whatever it is called in the repo.
writeFileSync(join(outputDir, "appsscript.json"), readFileSync(project.manifest));

const relativeOutput = outputDir.replace(repoRoot + "/", "");
console.log(`\nStaged ${projectName} -> ${relativeOutput}`);
console.log(`  ${project.description}`);
console.log(
	`  ${sourceFiles.length} .gs files (${(totalBytes / 1024).toFixed(1)} KB) + appsscript.json`,
);

if (!existsSync(join(workspaceDir, project.claspConfig))) {
	console.log(
		`\n  Note: ${project.claspConfig} does not exist yet, so nothing can be pushed.\n` +
			`  Copy .clasp.example.json to it and fill in scriptId (it is gitignored).\n` +
			`  Set "srcDir": "dist/${projectName}".`,
	);
}
console.log("");
