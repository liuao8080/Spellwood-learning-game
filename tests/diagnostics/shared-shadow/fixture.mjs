import { test as base, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
export { expect };
export const test=base.extend({sharedShadowEnvironment:[async({browser},use)=>{
  const manifest=JSON.parse(await readFile(process.env.SPELLWOOD_SHARED_SHADOW_MANIFEST,'utf8'));
  const metadata={schema:1,runId:manifest.runId,executionEnvironment:manifest.executionEnvironment,launch:manifest.launch,
    browserVersion:browser.version(),host:{platform:os.platform(),release:os.release(),architecture:os.arch(),cpu:os.cpus()[0]?.model||null,
      logicalCpus:os.cpus().length,memoryGiB:Math.round(os.totalmem()/1024**3)},formalAcceptance:false,
    resourceScope:'Host facts only; process utilization and GPU completion are unmeasured',
    factsScope:'Actual game renderer, buffer, quality and per-document clocks are collected per segment; no pre-attack capability prewarm'};
  const file=path.join(process.env.SPELLWOOD_LOCAL_EVIDENCE,`shared-shadow-${manifest.runId}-environment.json`);
  await writeFile(file,JSON.stringify(metadata,null,2));
  try{await use(metadata);}finally{
    let cdp;
    try{cdp=await browser.newBrowserCDPSession();const system=await cdp.send('SystemInfo.getInfo');
      metadata.postBodyGpuDevices=system.gpu?.devices?.map(device=>({vendorId:device.vendorId,deviceId:device.deviceId,vendorString:device.vendorString,
        deviceString:device.deviceString,driverVendor:device.driverVendor,driverVersion:device.driverVersion}))||[];
      metadata.postBodyGpuFeatures=system.gpu?.featureStatus||null;
    }catch{metadata.postBodyGpuQuery='unavailable; do not infer backend';}finally{await cdp?.detach().catch(()=>{});await writeFile(file,JSON.stringify(metadata,null,2));}
  }
},{scope:'worker',auto:true}]});
