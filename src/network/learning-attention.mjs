/** Small foreground-only participation clock. It never changes English mastery. */
export class LearningAttention {
 constructor({now=()=>globalThis.performance?.now?.()??Date.now(),visible=true}={}){this.now=now;this.visible=visible;this.entries=new Map();}
 accrue(){const now=this.now();for(const x of this.entries.values()){const delta=Math.max(0,now-x.last);if(this.visible)x[x.phase]+=delta;x.last=now;}}
 begin(id){if(this.entries.has(id))return;this.accrue();if(this.entries.size>=32)this.entries.delete(this.entries.keys().next().value);this.entries.set(id,{questionMs:0,feedbackMs:0,phase:'questionMs',last:this.now()});}
 feedback(id){this.accrue();const x=this.entries.get(id);if(x)x.phase='feedbackMs';}
 visibility(value){this.accrue();this.visible=!!value;}
 finish(id){this.accrue();const x=this.entries.get(id);this.entries.delete(id);if(!x||x.phase!=='feedbackMs')return null;return {questionMs:Math.floor(Math.min(x.questionMs,7200000)),feedbackMs:Math.floor(Math.min(x.feedbackMs,7200000))};}
 clear(){this.entries.clear();}
}
