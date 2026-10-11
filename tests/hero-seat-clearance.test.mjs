import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { ArenaScene } from "../src/arena3d/scene.mjs";
import { ALL_HERO_SKINS } from "../src/hero-skins.mjs";

// Real application geometry and projection, with mocked Canvas/renderer only.
// These tests do not claim browser pixels, gameplay, touch, or performance QA.
function harness(t, width, height) {
  const names = ["document", "window", "Image", "requestAnimationFrame", "cancelAnimationFrame", "devicePixelRatio"];
  const originals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const context = new Proxy({}, { get(target, key) {
    if (key === "measureText") return text => ({ width: String(text).length * 26 });
    if (String(key).startsWith("create")) return () => ({ addColorStop() {} });
    return target[key] || (() => {});
  } });
  const callbacks = new Map(); let serial = 0;
  const canvas = { dataset: {}, style: {}, getContext: () => context,
    getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }),
    addEventListener() {}, removeEventListener() {} };
  const globals = {
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) },
    window: { addEventListener() {}, removeEventListener() {} }, Image: class {}, devicePixelRatio: 1,
    requestAnimationFrame: callback => { callbacks.set(++serial, callback); return serial; },
    cancelAnimationFrame: id => callbacks.delete(id),
  };
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const renderer = { isSoftwareRenderer: true, lastRenderMs: 1, shadowMap: {},
    info: { render: { triangles: 0, calls: 0 } }, setPixelRatio() {}, setSize() {}, dispose() {},
    render(scene, camera) { scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); } };
  class GeometryScene extends ArenaScene { createRenderer() { return renderer; } }
  const scene = new GeometryScene({ canvas, quality: "low", externalHand: true, reduced: true });
  t.after(() => {
    scene.dispose();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  let now = performance.now();
  function frame() {
    const next = callbacks.entries().next().value;
    assert(next, "a requested geometry update is scheduled");
    callbacks.delete(next[0]); now += 100; next[1](now);
    assert.equal(scene.frameFault, undefined, "geometry update did not fail");
  }
  frame();
  return { scene, frame };
}

function populatedState(viewerSeat) {
  return { active: viewerSeat, phase: "playing", players: [0, 1].map(seat => ({
    hp: 18, hand: ["tidal_recall"], handCount: 3,
    board: ["fox", "rabbit", "sprout", "acorn_squirrel"].map((cardId, index) => ({
      uid: `${seat}:${index}`, cardId, atk: 2, hp: 2, maxHp: 2, ready: true,
    })),
    legalCardTargets: [{ index: 0, targets: [0, 1, 2, 3].map(index => ({ target: `${seat}:${index}` })) }],
  })) };
}

function labelRects(scene, seat) {
  return scene.snapshot.players[seat].board.map(unit => {
    const point = scene.labelPoint(scene.units.get(unit.uid));
    // Actual compact CSS uses a 56-by-44 control and translate(-50%, -5%).
    return { left: point.x - 28, right: point.x + 28, top: point.y - 2.2, bottom: point.y + 41.8, x: point.x };
  });
}

function visibleVertices(root, visit) {
  root.updateMatrixWorld(true);
  const point = new Vector3();
  root.traverse(mesh => {
    if (!mesh.isMesh || !mesh.visible || mesh.material.visible === false) return;
    const positions = mesh.geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
      visit(point, mesh);
    }
  });
}

function projectedBounds(scene, root) {
  const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  visibleVertices(root, point => {
    const p = scene.project(point);
    assert(p.visible, "visible geometry remains in the camera depth range");
    box.left = Math.min(box.left, p.x); box.right = Math.max(box.right, p.x);
    box.top = Math.min(box.top, p.y); box.bottom = Math.max(box.bottom, p.y);
  });
  return box;
}

const poses = [["bind", null]];
for (const action of ["idle", "charge", "cast", "hit", "heal", "armor", "win", "lose"])
  for (const progress of [0, .2, .5, .8, 1])
    poses.push([`${action}:${progress}`, action === "idle" ? { idlePhase: progress * 3, time: progress } : { action, progress }]);

for (const [width, height] of [[320, 222], [390, 414]]) {
  test(`${width}x${height}: both heroes, all 21 models, and sampled poses clear full-size labels`, t => {
    const { scene, frame } = harness(t, width, height);
    assert.equal(ALL_HERO_SKINS.length, 21, "base hero plus all twenty rewards");
    const coveredHeads = [];
    for (const viewerSeat of [0, 1]) {
      scene.setBattle(populatedState(viewerSeat), viewerSeat); frame();
      scene.scene.updateMatrixWorld(true);
      const own = labelRects(scene, viewerSeat), enemy = labelRects(scene, 1 - viewerSeat);
      const all = [...own, ...enemy];
      for (const row of [own, enemy]) {
        for (let index = 1; index < row.length; index++)
          assert(row[index].left >= row[index - 1].right + 5, "slot order and at least 5px horizontal gutter remain");
        for (const rect of row) {
          assert(rect.left >= 0 && rect.right <= width, "complete badge fits horizontally");
          assert(rect.top >= 0 && rect.bottom <= height - 12, "complete 44px badge clears the hand overlap");
        }
      }
      for (let index = 0; index < all.length; index++)
        for (const other of all.slice(index + 1))
          assert(all[index].right <= other.left || all[index].left >= other.right || all[index].bottom <= other.top || all[index].top >= other.bottom, "no full-size badge overlap");
      scene.select({ kind: "card", index: 0 }); frame();
      for (const relativeSeat of [0, 1]) for (let index = 0; index < 4; index++) {
        const seat = relativeSeat === 0 ? viewerSeat : 1 - viewerSeat;
        const uid = `${seat}:${index}`, item = scene.units.get(uid);
        assert(item.model.root.position.equals(item.base), "the real unit moves with its base");
        const carved = scene.arena.slots[relativeSeat][index].getWorldPosition(new Vector3());
        assert(Math.abs(carved.x - item.base.x) < (scene.splitFrontRow ? 1e-6 : .15), "carved ring and actual unit agree horizontally");
        assert(Math.abs(carved.z - item.base.z) <= .121, "carved ring retains its intentional ground offset");
        if (relativeSeat === 0) {
          const targetRing = scene.targetRings.get(uid);
          assert(targetRing, "real friendly targeting exposes each shifted slot");
          assert(targetRing.position.distanceTo(scene.anchor(uid, .04)) < 1e-8, "target ring follows the real unit anchor");
        }
        const shadow = scene.contactShadows.get(uid);
        assert(Math.abs(shadow.position.x - item.base.x - .12) < 1e-8, "contact shadow follows the shifted model");
      }
      const headNames = { fox: "fox-head", rabbit: "rabbit-head", sprout: "sprout-seed", acorn_squirrel: "squirrel-head-and-ear-tufts" };
      for (const unit of scene.snapshot.players[viewerSeat].board) {
        const item = scene.units.get(unit.uid), head = item.model.root.getObjectByName(headNames[unit.cardId]);
        assert(head, `${unit.cardId} exposes its actual authored head geometry`);
        for (const idlePhase of [0, 1, 2, 3]) {
          item.model.applyPose({ idlePhase });
          let points = 0, covered = 0, eyes = 0, coveredEyes = 0;
          visibleVertices(head, (point, mesh) => {
            points++;
            const p = scene.project(point);
            const isEye = mesh.material.name === "spellwood-eye";
            if (isEye) eyes++;
            if (enemy.some(rect => p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom)) {
              covered++;
              if (isEye) coveredEyes++;
            }
          });
          assert(points > 0, "head check examines real visible mesh vertices");
          assert(eyes > 0, "face check identifies the authored eye/nose material vertices");
          if (covered) coveredHeads.push({ card: unit.cardId, viewerSeat, idlePhase, covered, points, coveredEyes, eyes });
        }
      }
      for (const skin of ALL_HERO_SKINS) {
        scene.setHeroSkins({ self: skin.id, opponent: skin.id });
        assert.equal(scene.heroes[0].root.position.x, 0, "own hero keeps the front-center seat after cosmetic replacement");
        assert(scene.heroes[0].root.position.z > 0 && scene.heroes[1].root.position.z < 0, "front/back ownership is preserved");
        for (const hero of scene.heroes) for (const [name, pose] of poses) {
          hero.model.reset(); if (pose) hero.model.applyPose(pose);
          const box = projectedBounds(scene, hero.root), message = `${skin.id}, viewer ${viewerSeat}, relative hero ${hero.relativeSeat}, ${name}: ${JSON.stringify(box)}`;
          assert(box.left >= 6 && box.right <= width - 6 && box.top >= 4 && box.bottom <= height - 8, message);
          for (const rect of all)
            assert(box.right + 3 <= rect.left || box.left - 3 >= rect.right || box.bottom + 3 <= rect.top || box.top - 3 >= rect.bottom, `hero needs a 3px gutter from every badge: ${message}`);
          if (hero.relativeSeat === 0 && scene.splitFrontRow) {
            assert(box.left >= own[1].right + 5 && box.right <= own[2].left - 5, message);
            assert(box.top >= Math.max(...enemy.map(rect => rect.bottom)) + 6, message);
          } else if (hero.relativeSeat === 0) assert(box.top >= Math.max(...own.map(rect => rect.bottom)) + 6, message);
          if (name === "bind") assert(box.bottom - box.top >= (hero.relativeSeat === 0 ? 36 : 24), `hero must remain visibly sized: ${message}`);
        }
      }
    }
    assert.deepEqual(coveredHeads, [], "actual head geometry, including any separately counted eye/nose vertices, must clear enemy badges");
  });

  test(`${width}x${height}: actual merged dock geometry remains inside the frame`, t => {
    const { scene } = harness(t, width, height);
    const baseline = scene.library.createArena({ seed: 27, slotsPerSide: 4, rowDepth: scene.rowDepth + .12,
      backRowDepth: scene.enemyRowDepth + .12,
      frontSlots: scene.frontSlotXs?.map(x => x / scene.boardWidthScale),
      backSlots: scene.backSlotXs?.map(x => x / scene.boardWidthScale) });
    baseline.root.scale.x = scene.boardWidthScale;
    try {
      const key = point => `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`;
      const existing = new Set();
      visibleVertices(baseline.root, point => existing.add(key(point)));
      const dock = { count: 0, left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      // Subtract the otherwise-identical real arena geometry, leaving the merged
      // carved dock itself. This catches an out-of-frame pedestal, not only feet.
      visibleVertices(scene.arena.root, point => {
        if (existing.has(key(point))) return;
        const p = scene.project(point); dock.count++;
        dock.left = Math.min(dock.left, p.x); dock.right = Math.max(dock.right, p.x);
        dock.top = Math.min(dock.top, p.y); dock.bottom = Math.max(dock.bottom, p.y);
      });
      assert(dock.count > 0, "the added dock has actual merged geometry");
      assert(dock.left >= 6 && dock.right <= width - 6 && dock.top >= 0 && dock.bottom <= height - 2,
        `complete carved dock must fit: ${JSON.stringify(dock)}`);
      assert(dock.right - dock.left <= (scene.splitFrontRow ? 54 : 90), "dock remains a modest footprint");
    } finally { baseline.dispose(); }
  });
}
