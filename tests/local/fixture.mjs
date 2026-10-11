import { test as base, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export { expect };

export const test = base.extend({
  localEnvironment: [async ({ browser }, use, workerInfo) => {
    const context = await browser.newContext({ viewport: workerInfo.project.use.viewport || { width: 1280, height: 800 }, locale: 'zh-CN' });
    const page = await context.newPage();
    const webgl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const extension = gl?.getExtension('WEBGL_debug_renderer_info');
      const result = {
        context: gl ? gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl' : null,
        vendor: gl?.getParameter(gl.VENDOR) || null,
        renderer: gl?.getParameter(gl.RENDERER) || null,
        unmaskedVendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
        version: gl?.getParameter(gl.VERSION) || null,
        devicePixelRatio: window.devicePixelRatio,
        screen: { width: screen.width, height: screen.height, availableWidth: screen.availWidth, availableHeight: screen.availHeight },
        userAgent: navigator.userAgent,
      };
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      return result;
    });
    let graphicsFeatures = [];
    try {
      await page.goto('chrome://gpu');
      await page.waitForFunction(() => (document.querySelector('info-view')?.shadowRoot?.querySelector('#content')?.innerText || document.body?.innerText || '').includes('Graphics Feature Status'));
      graphicsFeatures = await page.evaluate(() => {
        const text = document.querySelector('info-view')?.shadowRoot?.querySelector('#content')?.innerText || document.body.innerText;
        return text.slice(text.indexOf('Graphics Feature Status'), text.indexOf('Version Information'))
          .split('\n').map(line => line.trim()).filter(line => /^(Canvas|Compositing|Direct Rendering Display Compositor|Multiple Raster Threads|OpenGL|Rasterization|Raw Draw|Skia Graphite|TreesInViz|Video Decode|Video Encode|Vulkan|WebGL|WebGL2|WebGPU|WebNN):/.test(line));
      });
    } catch { graphicsFeatures = ['Chrome GPU status unavailable; hardware acceleration unconfirmed']; }
    const softwareRenderer = /SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic Render/i.test(webgl.unmaskedRenderer || '');
    const environment = {
      schema: 1, runId: process.env.SPELLWOOD_LOCAL_RUN_ID, workerIndex: workerInfo.workerIndex,
      browser: 'Installed Google Chrome; headed', browserVersion: browser.version(),
      host: { platform: os.platform(), release: os.release(), architecture: os.arch(), cpu: os.cpus()[0]?.model || null,
        logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / (1024 ** 3)) },
      webgl, samplingViewport: page.viewportSize(), displayMetricScope: 'Browser context screen and DPR values are emulated; physical monitor resolution is not measured here',
      graphicsFeatures, softwareRenderer,
      hardwareAccelerationConfirmed: !softwareRenderer && Boolean(webgl.unmaskedRenderer) && graphicsFeatures.some(line => /^WebGL:\s*Hardware accelerated/.test(line)),
      flags: 'Playwright Chrome defaults with chromiumSandbox enabled and unsafe SwiftShader/self-XSS flags removed; no rendering-quality or game-rule override',
      caveats: ['Viewport simulation is not a physical phone', 'Two local cookie jars do not establish public human matchmaking',
        'This independent capability sample is not a full-session FPS measurement'],
    };
    await writeFile(path.join(process.env.SPELLWOOD_LOCAL_EVIDENCE, `environment-worker-${workerInfo.workerIndex}.json`), JSON.stringify(environment, null, 2));
    await context.close();
    await use(environment);
  }, { scope: 'worker', auto: true }],
});
