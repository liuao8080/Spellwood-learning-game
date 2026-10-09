// Read-only DOM/canvas sizing diagnostics. Does not change clocks, drawing,
// visibility, quality, game state, or the peer's rendering mode.
export async function beginStillArenaProbe(page) {
  await page.evaluate(() => {
    window.__stillArenaProbe?.finish();
    const start = performance.now(), frames = []; let raf = null, previous = null, stopped = false;
    const number = value => value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
    const timing = canvas => Object.fromEntries(['renderUpdateMs','renderSubmitMs','renderAnchorMs','frameGapMs','qualityLevel','pixelScale','shadowMapSize','sampleTime','sampleWindowMs','paintedFrames','rafCallbacks','maxRafGapMs']
      .map(key => [key, number(canvas?.dataset[key])]));
    const canvasState = id => {
      const canvas = document.getElementById(id); if (!canvas) return null;
      const rect = canvas.getBoundingClientRect(), style = getComputedStyle(canvas);
      return {buffer:[canvas.width,canvas.height],display:[rect.width,rect.height],
        client:[canvas.clientWidth,canvas.clientHeight],css:[style.width,style.height],
        transform:style.transform,imageRendering:style.imageRendering,hidden:canvas.hidden,
        renderer:['WebGL2','CPU · 兼容三维'].includes(canvas.dataset.renderer)?canvas.dataset.renderer:'other',
        sceneState:['running','paused','hidden','idle','on-demand','suspended','context-lost','faulted'].includes(canvas.dataset.sceneState)?canvas.dataset.sceneState:'other',
        reducedMotion:canvas.dataset.reducedMotion==='true'?true:canvas.dataset.reducedMotion==='false'?false:null,
        timing:timing(canvas)};
    };
    const read = () => ({elapsedMs:performance.now()-start,wallTime:Date.now(),devicePixelRatio:window.devicePixelRatio,
      visibility:document.visibilityState,reducedMotionMedia:matchMedia('(prefers-reduced-motion: reduce)').matches,
      arena:canvasState('arena'),hand:canvasState('hand-canvas')});
    const frame = now => {
      if (stopped) return;
      frames.push({elapsedMs:now-start,observerFrameGapMs:previous===null?null:now-previous,...timing(document.getElementById('arena'))});
      previous=now;
      if(frames.length<900)raf=requestAnimationFrame(frame);
    };
    window.__stillArenaProbe={read,finish(){stopped=true;if(raf!==null)cancelAnimationFrame(raf);const result={final:read(),frames,sampleLimit:900,sampleLimitReached:frames.length>=900};delete window.__stillArenaProbe;return result;}};
    raf=requestAnimationFrame(frame);
  });
}

export async function readStillArenaProbe(page) {
  return page.evaluate(() => window.__stillArenaProbe.read());
}

export async function finishStillArenaProbe(page) {
  return page.evaluate(() => window.__stillArenaProbe.finish());
}
