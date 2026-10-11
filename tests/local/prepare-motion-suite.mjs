import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { adaptLocalActorCleanup } from "./cleanup.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** This standalone diagnostic adapts local transport and bounded cleanup. It never selects official
 * CI, rewrites assertions, reduces quality, or changes the 250 ms motion gate.
 * Every run owns a unique generated folder and a fixed client bundle snapshot.
 */
export function prepareMotionSuite(root, runId, phase) {
  const directory = path.join(root, "test-results", `motion-suite-${runId}`);
  const evidenceDirectory = path.join(
    root,
    "test-results",
    "motion-evidence",
    runId,
  );
  const clientDirectory = path.join(evidenceDirectory, "client-bundle");
  mkdirSync(directory, { recursive: true });
  mkdirSync(evidenceDirectory, { recursive: true });
  const clientSource = process.env.SPELLWOOD_MOTION_CLIENT_ROOT
    ? path.resolve(process.env.SPELLWOOD_MOTION_CLIENT_ROOT)
    : path.join(root, "client-dist");
  const existingFile = path.join(evidenceDirectory, "source-manifest.json");
  const existing = existsSync(existingFile)
    ? JSON.parse(readFileSync(existingFile, "utf8"))
    : null;
  if (!existing) cpSync(clientSource, clientDirectory, { recursive: true });
  const files = ["helpers.mjs", "combat-motion-tools.mjs"].map((name) => {
    const file = `tests/e2e/${name}`,
      source = readFileSync(path.join(root, file), "utf8");
    let generated = source
      .replaceAll(
        "test-results/browser-evidence",
        path.relative(root, evidenceDirectory),
      )
      .replaceAll("http://127.0.0.1:4173", "http://127.0.0.1:4185")
      .replaceAll("127\\.0\\.0\\.1:4173", "127\\.0\\.0\\.1:4185");
    if (name === "helpers.mjs") {
      generated = generated
        .replace(
          "from '@playwright/test'",
          "from '../../tests/local/fixture.mjs'",
        )
        .replace(
          "from '../../scripts/e2e-server.mjs'",
          "from '../../tests/local/server.mjs'",
        );
      generated = adaptLocalActorCleanup(generated);
    }
    return { file, name, source, generated };
  });
  const driver = readFileSync(
    path.join(root, "tests/local/motion-evidence.spec.mjs"),
    "utf8",
  );
  files.push({
    file: "tests/local/motion-evidence.spec.mjs",
    name: "motion-evidence.spec.mjs",
    source: driver,
    generated: driver,
  });
  const git = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
  const productSources = git([
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "src",
    "server",
  ])
    .split("\n")
    .filter(Boolean)
    .map((file) => ({
      file,
      sha256: hash(readFileSync(path.join(root, file))),
    }));
  const infrastructure = [
    "playwright.motion.config.mjs",
    ...readdirSync(path.join(root, "tests/local"))
      .filter((name) => name.endsWith(".mjs"))
      .sort()
      .map((name) => `tests/local/${name}`),
  ].map((file) => ({
    file,
    sha256: hash(readFileSync(path.join(root, file))),
  }));
  const attribution = {
    bundleSha256: hash(readFileSync(path.join(clientDirectory, "app.js"))),
    productSources,
    infrastructure,
    files: files.map(({ file, name, source, generated }) => ({
      file,
      generatedFile: path.relative(root, path.join(directory, name)),
      sourceSha256: hash(source),
      generatedSha256: hash(generated),
    })),
    officialCIConfigSha256: hash(
      readFileSync(path.join(root, "playwright.config.mjs")),
    ),
    officialCIServerSha256: hash(
      readFileSync(path.join(root, "scripts/e2e-server.mjs")),
    ),
  };
  if (existing) {
    if (JSON.stringify(existing.attribution) !== JSON.stringify(attribution))
      throw new Error(
        "Motion sources changed during the run; use a fresh run ID.",
      );
    return { directory, evidenceDirectory, clientDirectory };
  }
  for (const { name, generated } of files)
    writeFileSync(path.join(directory, name), generated);
  writeFileSync(
    existingFile,
    JSON.stringify(
      {
        schema: 1,
        runId,
        phase,
        generatedAt: new Date().toISOString(),
        commit: git(["rev-parse", "HEAD"]),
        branch: git(["branch", "--show-current"]),
        dirtyFiles: git(["status", "--porcelain"])
          .split("\n")
          .filter(Boolean)
          .map((line) => line.slice(3)),
        clientSource,
        clientDirectory,
        configuredServerClientDirectory: clientDirectory,
        serverClientOverrideVariable: "SPELLWOOD_LOCAL_CLIENT_DIST",
        sourceScope: process.env.SPELLWOOD_MOTION_CLIENT_ROOT
          ? "Explicit prebuilt client snapshot; current source hashes are a runtime repository record, not proof of that snapshot compilation"
          : "Snapshot of the current built client with repository source hashes at run start",
        transportChanges: [
          "Official helper uses explicit local fixture and server",
          "Distinct 4185 loopback origin and unique evidence folder",
          "Shared local-only bounded actor/owned-server cleanup; timeout still fails and original page-error assertion is unchanged",
        ],
        officialAcceptanceAssertionChanges: 0,
        officialMaximumFrameGapSeconds: 0.25,
        diagnosticScope:
          "Separate supplemental normal-motion UI driver; never substitutes for official acceptance",
        attribution,
      },
      null,
      2,
    ),
  );
  return { directory, evidenceDirectory, clientDirectory };
}
