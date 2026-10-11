// Shared baseline/candidate renderer-level observation. No mesh callbacks are
// installed: the strict cache's callback safety checks remain meaningful.
export function installShadowLabObserver(arena, metadata) {
  const renderer = arena.renderer;
  const stats = { schema: 1, installed: false, ...metadata, timeOrigin: performance.timeOrigin,
    maxSamples: 240, samples: [], dropCount: 0, totalFrames: 0,
    totalDepthDraws: 0, totalColorDraws: 0, invalidCompleteColorFrames: 0, observerCpuMs: 0, observerMaxCpuMs: 0,
    trustedAttackMarkers: [], clocks: 'Separate document timeOrigin/performance.now; not native-media PTS' };
  globalThis.__shadowLab = stats;
  if (!renderer?.shadowMap?.render || !renderer.renderBufferDirect || !renderer.render) return {
    beginTicket() {}, endTicket() {}, contextEpoch: 0,
  };
  stats.installed = true;
  const nativeRender = renderer.render, nativeShadow = renderer.shadowMap.render, nativeBuffer = renderer.renderBufferDirect;
  let activeFrame = null, activeDepth = false, nextTicket = null, lastTicketFrame = null, contextEpoch = 0;
  const labelHash = text => { let a = 2166136261, b = 5381; for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i);
  } return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`; };
  for (const type of ['pointerdown', 'click']) globalThis.addEventListener(type, event => {
    if (event.target?.closest?.('[data-action]')?.dataset.action !== 'enemy-hero' || stats.trustedAttackMarkers.length >= 16) return;
    stats.trustedAttackMarkers.push({ type, trusted: event.isTrusted, absPerformanceTime: performance.now() });
  }, { capture: true, passive: true });
  for (const type of ['webglcontextlost', 'webglcontextrestored']) arena.canvas.addEventListener(type, () => {
    contextEpoch++; arena.shadowLabCache?.invalidate(type);
  });
  renderer.renderBufferDirect = function (...args) {
    const frame = activeFrame, depth = activeDepth;
    const calls = frame ? renderer.info.render.calls : 0;
    const triangles = frame ? renderer.info.render.triangles : 0;
    const result = nativeBuffer.apply(this, args);
    if (frame) {
      const start = performance.now(), delta = renderer.info.render.calls - calls;
      if (delta > 0) {
        if (depth) { frame.actualDepthDraws += delta; frame.depthCasters.add(args[4].id); frame.depthTriangles += renderer.info.render.triangles - triangles; }
        else { frame.actualColorDraws += delta; frame.colorObjects.add(args[4].id); frame.colorTriangles += renderer.info.render.triangles - triangles; }
      }
      frame.observerCpuMs += performance.now() - start;
    }
    return result;
  };
  renderer.shadowMap.render = function (...args) {
    const prior = activeDepth; activeDepth = true;
    if (activeFrame) activeFrame.shadowRenderEntries++;
    try { return nativeShadow.apply(this, args); }
    finally { activeDepth = prior; }
  };
  renderer.render = function (...args) {
    const start = performance.now(), priorFrame = activeFrame, ticketData = nextTicket;
    nextTicket = null;
    if (!ticketData) arena.shadowLabCache?.invalidate('external-render');
    const frame = { actualDepthDraws: 0, actualColorDraws: 0, depthCasters: new Set(), colorObjects: new Set(),
      shadowRenderEntries: 0, depthTriangles: 0, colorTriangles: 0, observerCpuMs: performance.now() - start };
    activeFrame = frame;
    const absPerformanceTime = performance.now(); let succeeded = false;
    try { const value = nativeRender.apply(this, args); succeeded = true; return value; }
    finally {
      const renderEnd = performance.now(), observeStart = performance.now(), profile = arena.appliedQuality || {};
      const sprites = arena.temporary?.children?.filter(object => object.isSprite) || [];
      const shadowMap = arena.shadowLight?.shadow?.map;
      // Native frame counters cover every renderer path. In installed Three
      // 0.186.1 sprites also use renderBufferDirect, so no extra delta is normal.
      // Only claim complete color counts for an unambiguous nonnested reset.
      const nativeTotalCalls = renderer.info.render.calls;
      const nativeTotalTriangles = renderer.info.render.triangles;
      const completeCountersValid = renderer.info.autoReset === true && priorFrame === null &&
        Number.isFinite(nativeTotalCalls) && nativeTotalCalls >= frame.actualDepthDraws + frame.actualColorDraws;
      const completeColorCalls = completeCountersValid ? nativeTotalCalls - frame.actualDepthDraws : null;
      const row = { absPerformanceTime, rendererCpuWallMs: renderEnd - absPerformanceTime, renderSucceeded: succeeded,
        scope: ticketData ? 'scene-frame' : 'external-render', actualDepthDraws: frame.actualDepthDraws,
        actualDrawnCasters: frame.depthCasters.size, actualColorDraws: completeColorCalls,
        completeColorCountersValid: completeCountersValid, rendererInfoAutoReset: renderer.info.autoReset === true,
        nestedRender: priorFrame !== null, nativeTotalCalls, nativeTotalTriangles,
        bufferDirectColorDraws: frame.actualColorDraws, bufferDirectColorObjects: frame.colorObjects.size,
        unclassifiedColorDraws: completeCountersValid ? completeColorCalls - frame.actualColorDraws : null,
        depthTriangles: frame.depthTriangles, bufferDirectColorTriangles: frame.colorTriangles,
        colorTriangles: completeCountersValid ? nativeTotalTriangles - frame.depthTriangles : null,
        shadowRenderEntries: frame.shadowRenderEntries, effectiveShadowMapPresent: Boolean(shadowMap?.texture && shadowMap.width > 0 && shadowMap.height > 0),
        effectiveShadowMapWidth: shadowMap?.width || null, effectiveShadowMapHeight: shadowMap?.height || null,
        reducedMotion: arena.reduced === true, hidden: arena.hidden === true, activeJobs: arena.jobs?.size || 0,
        temporarySprites: sprites.length, temporarySpriteOpacityTotal: sprites.reduce((sum, sprite) => sum + sprite.material.opacity, 0),
        animatingUnits: [...arena.units.values()].filter(item => item.animating).length,
        heroPoseFields: arena.heroes.reduce((sum, hero) => sum + Object.keys(hero.poses).length, 0),
        qualityLevel: Number.isFinite(profile.level) ? profile.level : null, pixelScale: Number.isFinite(profile.pixelScale) ? profile.pixelScale : null,
        shadowMapSize: Number.isFinite(profile.shadowMapSize) ? profile.shadowMapSize : null,
        ticket: ticketData ? ticketData.safe : null, helperPreCpuMs: ticketData?.helperPreCpuMs ?? null,
        helperPostCpuMs: null, helperOutcome: null, observerCpuMs: null };
      stats.samples.push(row); if (stats.samples.length > 240) { stats.samples.shift(); stats.dropCount++; }
      row.observerCpuMs = frame.observerCpuMs + (ticketData?.observerCpuMs || 0) + performance.now() - observeStart;
      stats.totalFrames++; stats.totalDepthDraws += row.actualDepthDraws;
      if (completeCountersValid) stats.totalColorDraws += row.actualColorDraws;
      else stats.invalidCompleteColorFrames++;
      stats.observerCpuMs += row.observerCpuMs; stats.observerMaxCpuMs = Math.max(stats.observerMaxCpuMs, row.observerCpuMs);
      if (ticketData) lastTicketFrame = row;
      activeFrame = priorFrame;
    }
  };
  return {
    get contextEpoch() { return contextEpoch; },
    beginTicket(ticket, helperPreCpuMs) {
      const start = performance.now();
      const key = ticket.key === undefined || ticket.key === null ? null : JSON.stringify(ticket.key);
      nextTicket = { helperPreCpuMs, safe: { reason: ticket.reason, eligible: ticket.eligible === true,
        inputSame: ticket.inputSame === true, mapSame: ticket.mapSame === true, explicitDirty: ticket.explicitDirty === true,
        casterCount: Number.isFinite(ticket.casterCount) ? ticket.casterCount : null, reuse: ticket.reuse === true,
        refresh: ticket.refresh === true, applied: ticket.applied === true, keyHash: key === null ? null : labelHash(key) },
        observerCpuMs: performance.now() - start };
    },
    endTicket(result, helperPostCpuMs) {
      if (!lastTicketFrame) return;
      lastTicketFrame.helperPostCpuMs = helperPostCpuMs;
      lastTicketFrame.helperOutcome = { committed: result?.committed === true, reused: result?.reused === true, reason: result?.reason || null };
      lastTicketFrame = null;
    },
  };
}
