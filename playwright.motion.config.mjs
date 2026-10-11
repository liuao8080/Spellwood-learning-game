import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareMotionSuite } from "./tests/local/prepare-motion-suite.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const phase = process.env.SPELLWOOD_MOTION_PHASE || "after";
if (!["before", "after"].includes(phase))
  throw new Error("Choose before or after motion evidence.");
const runId =
  process.env.SPELLWOOD_MOTION_RUN_ID ||
  `${phase}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId))
  throw new Error("Invalid motion run ID.");
process.env.SPELLWOOD_MOTION_RUN_ID = runId;
process.env.SPELLWOOD_LOCAL_RUN_ID = runId;
process.env.SPELLWOOD_LOCAL_PORT = "4185";
const { directory, evidenceDirectory, clientDirectory } = prepareMotionSuite(
  root,
  runId,
  phase,
);
process.env.SPELLWOOD_LOCAL_EVIDENCE = evidenceDirectory;
process.env.CLIENT_DIST = clientDirectory;
process.env.SPELLWOOD_LOCAL_CLIENT_DIST = clientDirectory;

export default defineConfig({
  testDir: directory,
  testMatch: "**/motion-evidence.spec.mjs",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 240_000,
  globalTimeout: 12 * 60_000,
  expect: { timeout: 12_000 },
  outputDir: path.join(
    root,
    "test-results",
    "motion-playwright-internal",
    runId,
  ),
  reporter: [["list"], ["./tests/local/motion-reporter.mjs"]],
  use: {
    browserName: "chromium",
    channel: "chrome",
    headless: false,
    launchOptions: {
      chromiumSandbox: true,
      ignoreDefaultArgs: [
        "--enable-unsafe-swiftshader",
        "--unsafely-disable-devtools-self-xss-warnings",
      ],
    },
    viewport: { width: 1280, height: 800 },
    locale: "zh-CN",
    actionTimeout: 12_000,
    navigationTimeout: 20_000,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
