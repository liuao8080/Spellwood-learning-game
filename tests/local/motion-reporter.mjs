import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export default class MotionReporter {
  tests = [];
  onTestEnd(test, result) {
    this.tests.push({
      title: test.title,
      status: result.status,
      expectedStatus: test.expectedStatus,
      durationMs: result.duration,
      retry: result.retry,
      errorCount: result.errors.length,
    });
  }
  async onEnd(result) {
    if (process.argv.includes("--list")) return;
    const directory = process.env.SPELLWOOD_LOCAL_EVIDENCE;
    const manifest = JSON.parse(
      await readFile(path.join(directory, "source-manifest.json"), "utf8"),
    );
    const matches = async (file, expected) => {
      try {
        return (
          createHash("sha256")
            .update(await readFile(file))
            .digest("hex") === expected
        );
      } catch {
        return false;
      }
    };
    const a = manifest.attribution;
    const checks = {
      fixedBundleUnchanged: await matches(
        path.join(manifest.clientDirectory, "app.js"),
        a.bundleSha256,
      ),
      repositoryProductSourcesUnchanged: (
        await Promise.all(
          a.productSources.map((item) => matches(item.file, item.sha256)),
        )
      ).every(Boolean),
      localInfrastructureUnchanged: (
        await Promise.all(
          a.infrastructure.map((item) => matches(item.file, item.sha256)),
        )
      ).every(Boolean),
      sourceAndGeneratedDriverUnchanged: (
        await Promise.all(
          a.files.flatMap((item) => [
            matches(item.file, item.sourceSha256),
            matches(item.generatedFile, item.generatedSha256),
          ]),
        )
      ).every(Boolean),
      officialCIUnchanged:
        (await matches("playwright.config.mjs", a.officialCIConfigSha256)) &&
        (await matches("scripts/e2e-server.mjs", a.officialCIServerSha256)),
    };
    const attributable = Object.values(checks).every(Boolean);
    await writeFile(
      path.join(directory, "motion-run.json"),
      JSON.stringify(
        {
          schema: 1,
          runId: manifest.runId,
          scope:
            "Supplemental local normal-motion driver; not official acceptance or a new performance gate",
          status: attributable ? result.status : "failed",
          executionStatus: result.status,
          attributable,
          checks,
          officialMaximumFrameGapSeconds: 0.25,
          tests: this.tests,
        },
        null,
        2,
      ),
    );
    if (!attributable) return { status: "failed" };
  }
}
