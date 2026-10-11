// playwright.motion.config.mjs copies this driver beside transport-only copies
// of the official helper. This source is separate from the acceptance suite.
import {
  test,
  expect,
  action,
  safeScreenshot,
  currentProgress,
  prepareMatch,
  confirmOpening,
  sync,
  uiCommand,
  waitForBoard,
  calmAnimations,
  sleep,
} from "./helpers.mjs";
import { normalMotion, publicState } from "./combat-motion-tools.mjs";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { extractCombatFrames } from "../../scripts/extract-combat-frames.mjs";
const directory = process.env.SPELLWOOD_LOCAL_EVIDENCE;
const save = (name, value) =>
  writeFile(
    path.join(directory, name + ".json"),
    JSON.stringify(value, null, 2),
  );

async function verifyServedBundle(actor) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, "source-manifest.json"), "utf8"),
  );
  const origin = new URL(actor.page.url()).origin;
  const [health, index, bundle] = await Promise.all([
    actor.page.request.get(origin + "/health"),
    actor.page.request.get(origin + "/"),
    actor.page.request.get(origin + "/app.js"),
  ]);
  const servedSha256 = createHash("sha256")
    .update(await bundle.body())
    .digest("hex");
  const record = {
    origin,
    clientDirectory: manifest.configuredServerClientDirectory,
    healthStatus: health.status(),
    healthBodyStatus: (await health.json()).status,
    indexStatus: index.status(),
    bundleStatus: bundle.status(),
    servedSha256,
    expectedSnapshotSha256: manifest.attribution.bundleSha256,
    hashMatched: servedSha256 === manifest.attribution.bundleSha256,
  };
  await save(`served-bundle-${actor.label}`, record);
  expect(record.healthStatus).toBe(200);
  expect(record.healthBodyStatus).toBe("ok");
  expect(record.indexStatus).toBe(200);
  expect(record.bundleStatus).toBe(200);
  expect(
    record.hashMatched,
    "real HTTP app.js must equal this run fixed snapshot",
  ).toBe(true);
}

async function capture(
  actor,
  name,
  canvasId,
  selector,
  click,
  { duration = 3000 } = {},
) {
  const record = {
    name,
    scope: `Only anonymous ${canvasId} canvas; no DOM, display capture or audio`,
    requestedFrameRate: 30,
    durationMs: duration,
    byteLimit: 2 * 1024 * 1024,
    savedRevealMaskBefore:
      currentProgress(actor)?.collection?.opening?.revealed ?? null,
    network: [],
  };
  const networkBegan = Date.now();
  const onRequest = (request) => {
    if (
      new URL(request.url()).pathname === "/api/progress/collection" &&
      request.method() === "POST"
    )
      record.network.push({
        kind: "request",
        action: request.postDataJSON()?.action?.kind || null,
        elapsedMs: Date.now() - networkBegan,
      });
  };
  const onResponse = async (response) => {
    if (
      new URL(response.url()).pathname === "/api/progress/collection" &&
      response.request().method() === "POST"
    ) {
      const data = await response.json().catch(() => null);
      record.network.push({
        kind: "response",
        ok: response.ok(),
        elapsedMs: Date.now() - networkBegan,
        savedRevealMask: data?.data?.collection?.opening?.revealed ?? null,
        revision: data?.revision ?? null,
      });
    }
  };
  actor.page.on("request", onRequest);
  actor.page.on("response", onResponse);
  let deliver;
  const done = new Promise((resolve) => {
    deliver = resolve;
  });
  const binding = `__evidenceCapture_${name.replaceAll("-", "_")}`;
  await actor.page.exposeBinding(binding, async (_source, data) => {
    const bytes =
      typeof data.base64 === "string"
        ? Buffer.from(data.base64, "base64")
        : null;
    if (bytes?.length && bytes.length <= record.byteLimit) {
      await writeFile(path.join(directory, name + ".webm"), bytes);
      record.recordingBytes = bytes.length;
    }
    record.capture = data.metadata;
    record.raf = data.raf;
    await save(name, record);
    deliver(record);
  });
  await actor.page.evaluate(
    ({ canvasId, selector, binding, duration }) =>
      new Promise((resolve, reject) => {
        const canvas = document.getElementById(canvasId),
          type = "video/webm;codecs=vp8";
        if (
          !(canvas instanceof HTMLCanvasElement) ||
          typeof MediaRecorder !== "function" ||
          !MediaRecorder.isTypeSupported(type) ||
          document.querySelector(".identity-panel,.identity-recovery")
        ) {
          reject(new Error("Anonymous capture unavailable"));
          return;
        }
        const stream = canvas.captureStream(30);
        if (
          stream.getVideoTracks().length !== 1 ||
          stream.getAudioTracks().length ||
          canvas.width * canvas.height > 1_000_000
        ) {
          stream.getTracks().forEach((t) => t.stop());
          reject(new Error("Capture scope limit"));
          return;
        }
        const recorder = new MediaRecorder(stream, {
            mimeType: type,
            videoBitsPerSecond: 1_200_000,
          }),
          chunks = [],
          samples = [];
        let start = performance.now(),
          clicked = null,
          pointerDown = null,
          previous = null,
          raf = null,
          stopped = false,
          total = 0,
          reason = "complete",
          stopTimer;
        const numberOrNull = (value) => {
          const parsed = Number.parseFloat(value);
          return Number.isFinite(parsed) ? parsed : null;
        };
        const observe = (now) => {
          if (previous !== null)
            samples.push({
              elapsedMs: now - start,
              intervalMs: now - previous,
              visibility: document.visibilityState,
              canvasConnected: canvas.isConnected,
              currentCanvasSame: document.getElementById(canvasId) === canvas,
              displayedPackCount:
                document.querySelector("#pack-count")?.textContent || null,
              revealControlsDisabled:
                document.querySelector('[data-action="collection-reveal-all"]')
                  ?.disabled ?? null,
              quality: numberOrNull(canvas.dataset.qualityLevel),
              pixelScale: numberOrNull(canvas.dataset.pixelScale),
              shadowMapSize: numberOrNull(canvas.dataset.shadowMapSize),
              frameGap: numberOrNull(canvas.dataset.frameGapMs),
              reducedMotion:
                canvas.dataset.reducedMotion === "false"
                  ? false
                  : canvas.dataset.reducedMotion === "true"
                    ? true
                    : null,
              phase:
                document.querySelector("#pack-instruction")?.textContent ||
                null,
            });
          previous = now;
          if (!stopped) raf = requestAnimationFrame(observe);
        };
        const stop = (why) => {
          if (stopped) return;
          stopped = true;
          reason = why;
          clearTimeout(stopTimer);
          clearTimeout(hardTimer);
          cancelAnimationFrame(raf);
          document.removeEventListener("click", onClick, true);
          document.removeEventListener("pointerdown", onPointerDown, true);
          if (recorder.state === "recording") recorder.stop();
        };
        const onClick = (e) => {
          if (clicked !== null || !e.isTrusted || !e.target.closest(selector))
            return;
          clicked = performance.now() - start;
          stopTimer = setTimeout(() => stop("complete"), duration);
        };
        const onPointerDown = (e) => {
          if (
            pointerDown !== null ||
            !e.isTrusted ||
            !e.target.closest(selector)
          )
            return;
          pointerDown = performance.now() - start;
          stopTimer = setTimeout(() => stop("complete"), duration);
        };
        const hardTimer = setTimeout(() => stop("hard-limit"), 6000);
        recorder.ondataavailable = (e) => {
          total += e.data.size;
          if (total > 2 * 1024 * 1024) {
            stop("size-limit");
            return;
          }
          if (e.data.size) chunks.push(e.data);
        };
        recorder.onerror = () => stop("failed");
        recorder.onstart = () => resolve();
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type }),
            bytes = new Uint8Array(await blob.arrayBuffer());
          let str = "";
          for (let i = 0; i < bytes.length; i += 16384)
            str += String.fromCharCode(...bytes.subarray(i, i + 16384));
          void window[binding]({
            base64: btoa(str),
            metadata: {
              reason,
              trustedClickElapsedMs: clicked,
              trustedPointerDownElapsedMs: pointerDown,
              width: canvas.width,
              height: canvas.height,
              audioTracks: 0,
              elapsedMs: performance.now() - start,
            },
            raf: {
              samples,
              maximumIntervalMs: Math.max(...samples.map((s) => s.intervalMs)),
              intervalsOver250ms: samples.filter((s) => s.intervalMs > 250)
                .length,
            },
          });
        };
        document.addEventListener("click", onClick, {
          capture: true,
          passive: true,
        });
        document.addEventListener("pointerdown", onPointerDown, {
          capture: true,
          passive: true,
        });
        raf = requestAnimationFrame(observe);
        recorder.start(250);
        if (recorder.state === "recording") resolve();
      }),
    {
      canvasId,
      selector: selector.replace(".unit-label.targetable", ".unit-label"),
      binding,
      duration,
    },
  );
  record.before = actor.observed.room ? publicState(actor) : null;
  let captured;
  try {
    await click();
    captured = await done;
  } finally {
    actor.page.off("request", onRequest);
    actor.page.off("response", onResponse);
  }
  record.after = actor.observed.room ? publicState(actor) : null;
  record.savedRevealMaskAfter =
    currentProgress(actor)?.collection?.opening?.revealed ?? null;
  if (record.recordingBytes)
    try {
      record.decoded = await extractCombatFrames({
        videoPath: path.join(directory, name + ".webm"),
        outputDirectory: path.join(directory, name + "-frames"),
        prefix: name,
      });
    } catch (error) {
      record.decodeError = error.code || "UNCLASSIFIED";
    }
  await save(name, record);
  return captured;
}

async function buildDeck(actor) {
  const page = actor.page,
    wanted = {
      fox: 3,
      spark: 3,
      bloom: 3,
      glass_snail: 3,
      sunseed_blessing: 3,
      lantern: 3,
      rabbit: 2,
    };
  await action(page, "library").click();
  const names = await action(page, "library-card").evaluateAll((elements) =>
    Object.fromEntries(
      elements.map((el) => [
        el.querySelector("strong").textContent,
        el.dataset.value,
      ]),
    ),
  );
  const draft = (
    await action(page, "library-slot").evaluateAll((elements) =>
      elements.map(
        (el) => el.querySelector("span:not(.library-art)").textContent,
      ),
    )
  ).map((name) => names[name]);
  const counts = () =>
    draft.reduce((r, id) => ({ ...r, [id]: (r[id] || 0) + 1 }), {});
  for (let step = 0; step < 20; step++) {
    const held = counts(),
      replacement = Object.keys(wanted).find(
        (id) => (held[id] || 0) < wanted[id],
      );
    if (!replacement) break;
    const index = draft.findIndex((id) => held[id] > (wanted[id] || 0));
    expect(index).toBeGreaterThanOrEqual(0);
    await page
      .locator(`[data-action="library-slot"][data-value="${index}"]`)
      .click();
    await page
      .locator(`[data-action="library-card"][data-value="${replacement}"]`)
      .click();
    draft[index] = replacement;
  }
  expect(counts()).toEqual(wanted);
  await action(page, "library-save").click();
  await expect(page.locator(".card-library")).toBeHidden();
  await expect.poll(() => currentProgress(actor)?.customDeck).toEqual(draft);
}

async function manualEnglishChoice(actor, label) {
  const question = await actor.page.locator(".quiz").innerText();
  const options = await action(actor.page, "answer").allTextContents();
  await save("pending-question", { label, question, options });
  let selection;
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline) {
    try {
      selection = JSON.parse(
        await readFile(path.join(directory, "selected-answer.json"), "utf8"),
      ).text;
      await unlink(path.join(directory, "selected-answer.json"));
      break;
    } catch {
      await sleep(300);
    }
  }
  await unlink(path.join(directory, "pending-question.json")).catch(() => {});
  expect(
    options.includes(selection),
    "Operator chooses from actually displayed English answers",
  ).toBe(true);
  return action(actor.page, "answer").filter({ hasText: selection });
}

test("passive original font and board layout evidence", async ({
  actors,
}, testInfo) => {
  const a = await actors("layout-A", { viewport: { width: 844, height: 390 } }),
    b = await actors("layout-B");
  await verifyServedBundle(a);
  await normalMotion(a);
  await calmAnimations(b);
  await prepareMatch(a);
  await prepareMatch(b);
  await Promise.all([a, b].map((x) => action(x.page, "match").click()));
  await Promise.all(
    [a, b].map((x) => expect(action(x.page, "opening-confirm")).toBeVisible()),
  );
  await confirmOpening(a, b);
  await a.page.bringToFront();
  const fonts = await a.page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = "bold 78px 'Noto Sans CJK SC',Georgia,serif";
    return {
      font: ctx.font,
      originalSourceCanvasWidth: 384,
      strokeWidth: 10,
      measurementScope:
        "Independent new canvas2d with original text font; does not inspect or alter application sprites",
      texts: ["+2生命上限", "+2护甲", "获得护盾", "护盾抵挡", "回到手牌"].map(
        (text) => ({
          text,
          advanceWidth: ctx.measureText(text).width,
          inkWidth:
            ctx.measureText(text).actualBoundingBoxLeft +
            ctx.measureText(text).actualBoundingBoxRight,
        }),
      ),
    };
  });
  const layouts = [];
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 320, height: 568 },
  ]) {
    await a.page.setViewportSize(viewport);
    await waitForBoard(a);
    await a.page.locator("#hand-semantics [data-hand-index]").first().focus();
    await a.page.keyboard.press("Enter");
    const geometry = await a.page.evaluate(() => {
      const rect = (e) => {
        const r = e.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          right: r.right,
          bottom: r.bottom,
        };
      };
      const notice = document.querySelector("#notice"),
        hand = document.querySelector("#hand-canvas");
      return {
        viewport: { width: innerWidth, height: innerHeight },
        notice: {
          text: notice.textContent,
          hidden: notice.hidden,
          kind: notice.dataset.kind,
          rect: rect(notice),
        },
        hand: rect(hand),
        heroNames: [...document.querySelectorAll(".hero-panel strong")].map(
          (el) => ({
            text: el.textContent,
            clientWidth: el.clientWidth,
            scrollWidth: el.scrollWidth,
            rect: rect(el),
            outer: rect(el.closest(".hero-panel")),
          }),
        ),
      };
    });
    layouts.push(geometry);
    await safeScreenshot(
      a.page,
      testInfo,
      `original-selected-${viewport.width}x${viewport.height}`,
    );
    await action(a.page, "clear").click();
  }
  await save("font-layout", {
    fonts,
    layouts,
    bundleScope:
      "Manifest-attributed fixed client-dist; passive new canvas2d text measure only; no product canvas mutation",
  });
});

test("normal fullscreen pack opening and individual reveal evidence", async ({
  actors,
}, testInfo) => {
  const a = await actors("pack-motion", {
    viewport: { width: 1280, height: 720 },
    reducedMotion: "no-preference",
  });
  await normalMotion(a);
  const p = a.page;
  await verifyServedBundle(a);
  await action(p, "camp-more").click();
  await action(p, "collection").click();
  await p.locator('[data-action="collection-open"][data-value="test"]').click();
  await expect(p.locator("#pack-canvas")).toBeVisible();
  await safeScreenshot(p, testInfo, "sealed-before");
  const opening = await capture(
    a,
    "pack-opening",
    "pack-canvas",
    "#pack-canvas",
    () => p.locator("#pack-canvas").click({ position: { x: 640, y: 260 } }),
    { duration: 4200 },
  );
  await expect(p.locator("#pack-instruction")).toContainText("点击一张卡");
  await safeScreenshot(p, testInfo, "ready-after-opening");
  const before = currentProgress(a).collection.opening.revealed;
  const reveal = await capture(
    a,
    "pack-reveal",
    "pack-canvas",
    "#pack-canvas",
    () => p.locator("#pack-canvas").click({ position: { x: 320, y: 140 } }),
  );
  await expect(p.locator("#pack-count")).toHaveText("已揭开 1/10");
  expect(currentProgress(a).collection.opening.revealed).toBe(before | 1);
  await safeScreenshot(p, testInfo, "one-card-revealed");
  await save("pack-summary", {
    normalMotion: true,
    openingMaximumRafMs: opening.raf.maximumIntervalMs,
    revealMaximumRafMs: reveal.raf.maximumIntervalMs,
    openingMaximumRecordedGapSeconds:
      opening.decoded?.video.maximumFrameGapSeconds,
    revealMaximumRecordedGapSeconds:
      reveal.decoded?.video.maximumFrameGapSeconds,
    authoritativeRevealedBefore: before,
    authoritativeRevealedAfter: currentProgress(a).collection.opening.revealed,
    caveat:
      "Native arena/canvas recording has overhead; only synthetic anonymous local gameplay. Desktop viewport; no physical phone or public multiplayer acceptance.",
  });
  expect(opening.capture.reason).toBe("complete");
  expect(opening.capture.trustedPointerDownElapsedMs).not.toBeNull();
  expect(opening.decoded?.selectedFrames.length).toBeGreaterThanOrEqual(6);
  expect(reveal.capture.reason).toBe("complete");
  expect(reveal.capture.trustedPointerDownElapsedMs).not.toBeNull();
  expect(
    reveal.raf.samples.every(
      (sample) => sample.canvasConnected && sample.currentCanvasSame,
    ),
    "a real reveal must keep its original recorded canvas alive",
  ).toBe(true);
  expect(
    reveal.decoded?.selectedFrames.length,
    "a reveal clip must contain actual varying source frames",
  ).toBeGreaterThanOrEqual(6);
});

test("normal ritual projectile healing shield and maximum health evidence", async ({
  actors,
}, testInfo) => {
  test.setTimeout(480_000);
  const a = await actors("element-motion-A", {
      viewport: { width: 844, height: 390 },
      reducedMotion: "no-preference",
    }),
    b = await actors("element-motion-B");
  await verifyServedBundle(a);
  await normalMotion(a);
  await calmAnimations(b);
  for (const actor of [a, b]) {
    await buildDeck(actor);
    await prepareMatch(actor);
    await actor.page.locator("#deck").selectOption("custom");
  }
  await Promise.all([a, b].map((x) => action(x.page, "match").click()));
  await Promise.all(
    [a, b].map((x) => expect(action(x.page, "opening-confirm")).toBeVisible()),
  );
  await confirmOpening(a, b);
  const seen = new Set(),
    effects = [];
  let ritualAttempted = false;
  for (let turn = 0; turn < 32 && seen.size < 4; turn++) {
    const actor = [a, b].find(
        (x) => x.observed.room.youSeat === a.observed.room.activeSeat,
      ),
      other = actor === a ? b : a;
    await actor.page.bringToFront();
    await waitForBoard(actor);
    if (actor === a && !ritualAttempted) {
      await actor.page
        .locator('[data-action="ritual"][data-value="spark"]')
        .click();
      await action(actor.page, "enemy-hero").click();
      await expect(action(actor.page, "answer").first()).toBeVisible();
      await sleep(2100);
      const choice = await manualEnglishChoice(actor, "A-ritual-spark");
      const commands = actor.observed.commands.length,
        events = new Set(actor.observed.events.keys());
      const evidence = await capture(
        actor,
        "ritual-spark",
        "arena",
        '[data-action="answer"]',
        () => uiCommand(actor, () => choice.click()),
      );
      evidence.outcome = actor.observed.privateFeedback?.outcome;
      evidence.commands = actor.observed.commands.slice(commands).map((c) => ({
        type: c.type,
        action: c.action,
        accepted: actor.observed.acknowledgements.get(c.id)?.ok === true,
      }));
      evidence.events = [...actor.observed.events]
        .filter(([id]) => !events.has(id))
        .map(([, event]) => event);
      await save("ritual-spark", evidence);
      expect(
        evidence.outcome,
        "a correctly answered visible English spark must be demonstrated",
      ).toBe("correct");
      expect(evidence.commands).toHaveLength(1);
      expect(evidence.commands[0].accepted).toBe(true);
      expect(evidence.events).toHaveLength(1);
      expect(evidence.after.players[1 - actor.observed.room.youSeat].hp).toBe(
        evidence.before.players[1 - actor.observed.room.youSeat].hp - 2,
      );
      await expect(
        action(actor.page, "recap-expand")
          .or(action(actor.page, "quiz-close"))
          .first(),
      ).toBeVisible();
      if (await action(actor.page, "recap-expand").isVisible())
        await action(actor.page, "recap-expand").click();
      await sleep(1300);
      await action(actor.page, "quiz-close").click();
      await sync(a, b);
      ritualAttempted = true;
      seen.add("ritual");
      await safeScreenshot(actor.page, testInfo, "after-ritual");
    }
    for (let move = 0; move < 8; move++) {
      await waitForBoard(actor);
      const room = actor.observed.room;
      if (room.phase === "finished") break;
      const own = room.players[room.youSeat],
        options = room.selfLegalCardTargets.map((o) => ({
          ...o,
          card: room.selfHandCards[o.index],
        }));
      let chosen;
      if (actor === a) {
        chosen =
          options.find(
            (o) =>
              o.card === "glass_snail" &&
              o.targets.length &&
              !seen.has("shield"),
          ) ||
          options.find(
            (o) =>
              o.card === "sunseed_blessing" &&
              o.targets.length &&
              !seen.has("maximum-health"),
          ) ||
          options.find(
            (o) =>
              o.card === "bloom" &&
              o.untargeted &&
              own.hp < 18 &&
              !seen.has("heal"),
          ) ||
          options.find(
            (o) =>
              ["fox", "lantern", "rabbit"].includes(o.card) &&
              o.untargeted &&
              own.board.length < 3,
          );
      } else
        chosen = options.find(
          (o) =>
            o.card === "spark" &&
            o.targets.some((t) => t.target === "hero") &&
            a.observed.room.players[a.observed.room.youSeat].hp > 10 &&
            !seen.has("heal"),
        );
      if (!chosen) break;
      await actor.page
        .locator(`#hand-semantics [data-hand-index="${chosen.index}"]`)
        .focus();
      await actor.page.keyboard.press("Enter");
      await expect(actor.page.locator(".card-command")).toBeVisible();
      const target = chosen.targets[0],
        selector = chosen.untargeted
          ? '[data-action="play"]'
          : target.target === "hero"
            ? '[data-action="enemy-hero"]'
            : `.unit-label.targetable[data-seat="${target.seat}"][data-uid="${target.target}"]`;
      const kind = {
        glass_snail: "shield",
        sunseed_blessing: "maximum-health",
        bloom: "heal",
      }[chosen.card];
      const commandStart = actor.observed.commands.length,
        eventIds = new Set(actor.observed.events.keys());
      if (kind && actor === a) {
        const effect = await capture(actor, kind, "arena", selector, () =>
          uiCommand(actor, () => actor.page.locator(selector).click()),
        );
        await sync(a, b);
        effect.card = chosen.card;
        effect.commands = actor.observed.commands
          .slice(commandStart)
          .map((c) => ({
            type: c.type,
            action: c.action,
            accepted: actor.observed.acknowledgements.get(c.id)?.ok === true,
          }));
        effect.events = [...actor.observed.events]
          .filter(([id]) => !eventIds.has(id))
          .map(([, event]) => event);
        effects.push({
          kind,
          card: chosen.card,
          before: effect.before,
          after: effect.after,
        });
        seen.add(kind);
        await save(kind, effect);
        expect(effect.commands).toHaveLength(1);
        expect(effect.commands[0].accepted).toBe(true);
        expect(effect.events).toHaveLength(1);
        const beforePlayer = effect.before.players[room.youSeat],
          afterPlayer = effect.after.players[room.youSeat];
        if (kind === "heal")
          expect(afterPlayer.hp).toBe(Math.min(18, beforePlayer.hp + 5));
        else {
          const beforeUnit = effect.before.players[target.seat].board.find(
              (unit) => unit.uid === target.target,
            ),
            afterUnit = effect.after.players[target.seat].board.find(
              (unit) => unit.uid === target.target,
            );
          if (kind === "shield") {
            expect(beforeUnit.shield).toBe(false);
            expect(afterUnit.shield).toBe(true);
            expect(afterPlayer.board).toHaveLength(
              beforePlayer.board.length + 1,
            );
          } else {
            expect(afterUnit.maxHp).toBe(beforeUnit.maxHp + 2);
            expect(afterUnit.hp).toBe(
              Math.min(beforeUnit.hp + 2, beforeUnit.maxHp + 2),
            );
          }
        }
        await safeScreenshot(actor.page, testInfo, "after-" + kind);
      } else {
        await uiCommand(actor, () => actor.page.locator(selector).click());
        await sync(a, b);
      }
    }
    if (seen.size >= 4 || actor.observed.room.phase === "finished") break;
    await waitForBoard(actor);
    await uiCommand(actor, () => action(actor.page, "end").click());
    await sync(a, b);
  }
  await save("element-summary", {
    seen: [...seen],
    effects,
    normalMotionViewer: "A",
    otherReducedMotion: true,
    coverageGap: ["ritual", "shield", "maximum-health", "heal"].filter(
      (kind) => !seen.has(kind),
    ),
    caveat:
      "Only public visible UI with natural deck shuffle, a local synthetic peer, installed headed Chrome; not a physical phone or public human matchmaking check.",
  });
  expect([...seen].sort()).toEqual([
    "heal",
    "maximum-health",
    "ritual",
    "shield",
  ]);
  expect(a.observed.errors).toEqual([]);
  expect(b.observed.errors).toEqual([]);
});
