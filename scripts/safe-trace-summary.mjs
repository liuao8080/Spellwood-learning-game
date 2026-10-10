const allowed = new Set(['RunTask','RunMicrotasks','FunctionCall','FireAnimationFrame','UpdateLayoutTree','UpdateLayerTree','Layout','PrePaint','Paint','Layerize','CompositeLayers','Commit','DrawFrame','SubmitCompositorFrame','RasterTask','GPUTask','GLES2DecoderImpl::DoCommands','SkiaOutputSurfaceImplOnGpu::SwapBuffers','Display::DrawAndSwap','ProxyMain::BeginMainFrame','ThreadProxy::BeginMainFrame']);

/** Numeric aggregates only. Never retain trace args, URLs, function names,
 * identifiers, raw events or screenshot payloads. Missing names are unknown,
 * not zero-cost proof. Overlapping slices must not be summed as wall time. */
export function createSafeTraceSummary() {
  const buckets = new Map(); let seen = 0, accepted = 0;
  return {
    add(events) {
      for (const event of events) {
        seen++;
        if (!allowed.has(event.name) || event.ph !== 'X' || !Number.isFinite(event.dur) || event.dur < 0) continue;
        accepted++;
        const b = buckets.get(event.name) || { count:0, totalMs:0, maximumMs:0, over50Ms:0, over250Ms:0 };
        const duration = event.dur / 1000;
        b.count++; b.totalMs += duration; b.maximumMs = Math.max(b.maximumMs,duration);
        if(duration>50)b.over50Ms++; if(duration>250)b.over250Ms++;
        buckets.set(event.name,b);
      }
    },
    result() { return { seen, accepted, events:Object.fromEntries([...buckets].map(([name,b])=>[name,{...b,totalMs:Math.round(b.totalMs*100)/100,maximumMs:Math.round(b.maximumMs*100)/100}])),
      caveat:'Trace adds diagnostic overhead. Overlapping threads/slices are not wall time. Missing event names do not establish absence of work. No raw trace retained.' }; },
  };
}
