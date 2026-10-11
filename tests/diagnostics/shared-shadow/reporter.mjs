import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
export default class SharedShadowReporter {
  tests=[];
  onTestEnd(test,result){this.tests.push({title:test.title,playwrightStatus:result.status,expectedStatus:test.expectedStatus,durationMs:result.duration,
    retry:result.retry,errorCount:result.errors.length,coverage:test.annotations.filter(item=>item.type==='coverage').map(item=>item.description)});}
  async onEnd(result){if(process.argv.includes('--list'))return;
    const manifest=JSON.parse(await readFile(process.env.SPELLWOOD_SHARED_SHADOW_MANIFEST,'utf8'));
    const matches=async item=>{try{return createHash('sha256').update(await readFile(item.file)).digest('hex')===item.sha256;}catch{return false;}};
    const sourceIntegrity={};for(const [group,items]of Object.entries(manifest.attribution))sourceIntegrity[group]=(await Promise.all((Array.isArray(items)?items:[items]).map(matches))).every(Boolean);
    const attributable=Object.values(sourceIntegrity).every(Boolean);
    const directory=process.env.SPELLWOOD_LOCAL_EVIDENCE;
    const diagnostic=await readFile(path.join(directory,`shared-shadow-${manifest.runId}-checkpoints.json`),'utf8').then(JSON.parse).catch(()=>null);
    const segments=diagnostic?.segments||[],nativeGapFailures=segments.filter(item=>item.nativeGapVerdict==='failed');
    const completed=diagnostic?.status==='diagnostic-completed'&&segments.length===4&&segments.every(item=>item.status==='measured');
    const cacheObservations=segments.map(segment=>{
      const rows=segment.fullColorFloatFrames||[];
      const reused=rows.filter(row=>row.renderSucceeded===true&&row.helperOutcome?.committed===true&&row.helperOutcome?.reused===true&&
        row.ticket?.eligible&&row.ticket.reuse&&row.ticket.inputSame&&row.ticket.mapSame&&
        row.actualDepthDraws===0&&row.completeColorCountersValid&&row.actualColorDraws>0&&row.effectiveShadowMapPresent);
      const baseline=rows.filter(row=>row.renderSucceeded===true&&row.helperOutcome?.committed===true&&row.ticket?.eligible&&
        row.ticket.inputSame&&row.actualDepthDraws>0&&row.completeColorCountersValid&&row.actualColorDraws>0);
      return {index:segment.index,variant:segment.variant,floatFrames:rows.length,validMapReuseWithFullColorFrames:reused.length,
        repeatedInputWithActualDepthFrames:baseline.length,ticketReasons:segment.keyEligibilityReasons,
        verdict:segment.variant==='candidate'?reused.length>=3?'reuse-observed-needs-pixel-validation':'reuse-not-established':
          baseline.length>=3?'repeated-depth-observed':'baseline-repeat-not-established'};
    });
    await writeFile(path.join(directory,`shared-shadow-${manifest.runId}-report.json`),JSON.stringify({schema:1,runId:manifest.runId,
      formalAcceptance:false,playwrightExecutionStatus:result.status,attributable,sourceIntegrity,tests:this.tests,
      diagnosticOutcome:!attributable?'invalid-source-drift':!completed?'diagnostic-incomplete':nativeGapFailures.length?'diagnostic-completed-with-original-gap-failures':'diagnostic-completed-within-recorded-gap-rule',
      originalGapRuleMs:250,nativeGapFailureSegments:nativeGapFailures.map(item=>item.index),completeSegments:segments.filter(item=>item.status==='measured').length,cacheObservations,
      caveat:'A diagnostic completing is not green acceptance. Original formal CI and its prior failure remain independent; natural-turn/reload state confounds are recorded.',
      sourceHead:manifest.sourceHead,checkoutHead:manifest.checkoutHead,sourceTree:manifest.sourceTree,sourceTreeScope:manifest.sourceTreeScope,
      formalAppSha256:manifest.build.formalSha,executionEnvironment:manifest.executionEnvironment,
    },null,2));
    console.log(`Shared-shadow diagnostic: ${!attributable?'invalid-source-drift':!completed?'incomplete':nativeGapFailures.length?'completed-with-original250ms-gap-failures':'completed-within-recorded250ms-gap-rule'}; formal acceptance: false.`);
    if(!attributable)return{status:'failed'};
  }
}
