import {Scene,PerspectiveCamera,WebGLRenderer,Color,FogExp2,HemisphereLight,DirectionalLight,Raycaster,Vector2,Vector3,Box3,SRGBColorSpace,ACESFilmicToneMapping,PCFShadowMap} from 'three';
import {SoftwareRenderer} from './software-renderer.mjs';
import {createLobbyWorld} from './lobby-model.mjs';
import {LobbyTextures} from './lobby-textures.mjs';

/** Independent home diorama. Battle, rewards and learning own their state. */
export class LobbyScene{
 constructor({canvas,onPick=()=>{},onStatus=()=>{},reduced=false}={}){
  this.canvas=canvas;this.onPick=onPick;this.onStatus=onStatus;this.reduced=!!reduced;this.hidden=false;this.destroyed=false;this.running=false;this.needsRender=true;
  this.scene=new Scene();this.scene.background=new Color('#071b20');this.scene.fog=new FogExp2('#071b20',.018);
  this.camera=new PerspectiveCamera(39,1,.1,90);this.look=new Vector3(0,2.65,-.45);this.pointer=new Vector2();this.raycaster=new Raycaster();
  try{this.renderer=this.createRenderer(canvas);}catch(error){this.onStatus({available:false,renderer:'unavailable',reason:String(error.message)});return;}
  this.renderer.outputColorSpace=SRGBColorSpace;this.renderer.toneMapping=ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.07;
  this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=PCFShadowMap;
  this.scene.add(new HemisphereLight('#dcecca','#204237',1.9));const sun=new DirectionalLight('#ffdda0',3.3);sun.position.set(-6,13,9);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-11,right:11,top:10,bottom:-8,near:1,far:35});sun.shadow.normalBias=.035;this.scene.add(sun);
  const rim=new DirectionalLight('#71bad0',1.1);rim.position.set(6,5,-6);this.scene.add(rim);
  this.textures=new LobbyTextures(()=>{if(this.renderer?.isSoftwareRenderer)this.renderer.staticFrame=null;this.requestRender();});
  this.world=createLobbyWorld({quality:'low',textures:this.textures});this.scene.add(this.world.root);this.world.animate(0,true);
  this.rendererName=this.renderer.isSoftwareRenderer?'CPU · 兼容三维':'WebGL2';canvas.dataset.renderer=this.rendererName;
  this.bind();this.resize();this.onStatus({available:true,renderer:this.rendererName,scene:'lobby',triangles:this.world.metrics().triangles});this.start();
 }
 createRenderer(canvas){try{return new WebGLRenderer({canvas,alpha:false,antialias:true,powerPreference:'default'});}catch{return new SoftwareRenderer(canvas);}}
 bind(){
  this.handlers={resize:()=>this.resize(),down:e=>{if(e.button!==0||e.isPrimary===false||this.hidden)return;this.down={id:e.pointerId,x:e.clientX,y:e.clientY,action:this.pick(e),cancelled:false};},move:e=>{const r=this.canvas.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/Math.max(1,r.width)*2-1,(e.clientY-r.top)/Math.max(1,r.height)*2-1);if(this.down&&this.down.id===e.pointerId&&Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y)>10)this.down.cancelled=true;},up:e=>{const down=this.down;this.down=null;if(!down||this.hidden||down.cancelled||down.id!==e.pointerId||!down.action||down.action!==this.pick(e))return;this.onPick(down.action);},cancel:()=>{this.down=null;},blur:()=>{this.down=null;},lost:event=>{event.preventDefault?.();this.contextLost=true;this.down=null;this.stop();this.onStatus({available:false,renderer:this.rendererName,scene:'lobby',reason:'context-lost'});},restored:()=>{if(this.destroyed)return;this.contextLost=false;this.requestRender();this.onStatus({available:true,renderer:this.rendererName,scene:'lobby',reason:null});}};
  for(const [event,key]of[['pointerdown','down'],['pointermove','move'],['pointerup','up'],['pointercancel','cancel'],['lostpointercapture','cancel'],['pointerleave','cancel'],['webglcontextlost','lost'],['webglcontextrestored','restored']])this.canvas.addEventListener(event,this.handlers[key]);
  window.addEventListener('resize',this.handlers.resize);window.addEventListener('blur',this.handlers.blur);
  if(globalThis.ResizeObserver){this.observer=new ResizeObserver(this.handlers.resize);this.observer.observe(this.canvas);}
 }
 pick(event){if(!this.world||this.hidden)return null;const r=this.canvas.getBoundingClientRect(),p=new Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);this.scene.updateMatrixWorld(true);this.camera.updateMatrixWorld(true);this.raycaster.setFromCamera(p,this.camera);for(const hit of this.raycaster.intersectObjects(this.world.interactive,true)){let o=hit.object;while(o&&!o.userData.lobbyAction)o=o.parent;if(o)return o.userData.lobbyAction;}return null;}
 resize(){
  if(!this.renderer||this.destroyed)return;this.down=null;const r=this.canvas.getBoundingClientRect();if(r.width<=0||r.height<=0)return;const w=r.width,h=r.height,portrait=w/h<.85;if(w===this.width&&h===this.height){this.requestRender();return;}
  this.width=w;this.height=h;this.camera.aspect=w/h;this.camera.position.set(0,portrait?8.0:h<460?8.8:8.65,portrait?17.5:18.5);this.camera.lookAt(this.look);this.camera.updateProjectionMatrix();
  this.world.layout(portrait,h<460&&w/h>1.4);if(portrait)this.fitPortraitCompanions(w);const scale=this.renderer.isSoftwareRenderer?Math.min(1,Math.sqrt(720000/(w*h))):1;this.pendingSize={ratio:Math.min(globalThis.devicePixelRatio||1,1.5),width:Math.round(w*scale),height:Math.round(h*scale)};if(this.renderer.isSoftwareRenderer)this.renderer.staticFrame=null;this.requestRender();
 }
 fitPortraitCompanions(width){
  const buttonWidth=width<=600?Math.min(240,width-100):282,lane=(width-buttonWidth)/2;
  const desiredWidth=Math.min(width<=600?72:120,Math.max(28,lane-16)),z=4.85;
  this.camera.updateMatrixWorld(true);
  const bounds=root=>{root.updateWorldMatrix(true,true);const box=new Box3().setFromObject(root),points=[];for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z]){const p=new Vector3(x,y,z).project(this.camera);points.push((p.x+1)*width/2);}return{left:Math.min(...points),right:Math.max(...points)};};
  for(const [index,buddy]of this.world.buddies.entries()){
   this.world.placeBuddy(index,{x:0,z,scale:1});const base=bounds(buddy.root);
   const scale=Math.min(.62,Math.max(.20,desiredWidth/(base.right-base.left)));
   this.world.placeBuddy(index,{x:0,z,scale});const current=bounds(buddy.root),center=(current.left+current.right)/2;
   const p0=new Vector3(0,.45,z).project(this.camera),p1=new Vector3(1,.45,z).project(this.camera),pixelsPerUnit=(p1.x-p0.x)*width/2;
   const target=index?width-lane/2:lane/2;this.world.placeBuddy(index,{x:(target-center)/pixelsPerUnit,z,scale});
  }
 }
 flushResize(){if(!this.pendingSize)return;const size=this.pendingSize;this.pendingSize=null;this.renderer.setPixelRatio(size.ratio);this.renderer.setSize(size.width,size.height,false);}
 setReduced(value){this.reduced=!!value;this.requestRender();}
 setHidden(value){if(this.hidden===!!value)return;this.hidden=!!value;this.down=null;if(this.hidden)this.stop();else{this.resize();this.requestRender();}}
 requestRender(){this.needsRender=true;if(!this.hidden)this.start();}
 start(){
  if(this.running||this.hidden||this.destroyed||!this.renderer||this.contextLost)return;this.running=true;this.metricStart=performance.now();this.metricFrames=0;
  const frame=now=>{if(!this.running||this.hidden||this.destroyed)return;this.frame=null;const interval=this.renderer.isSoftwareRenderer?(this.renderCost>35?49:32):16;
   if(this.lastFrame&&now-this.lastFrame<interval){this.frame=requestAnimationFrame(frame);return;}this.lastFrame=now;this.needsRender=false;
   try{this.world.animate(now,this.reduced);if(!this.renderer.isSoftwareRenderer&&!this.reduced){this.camera.position.x+=(this.pointer.x*.24-this.camera.position.x)*.04;this.camera.lookAt(this.look);}
    this.flushResize();this.renderer.render(this.scene,this.camera);const cost=this.renderer.lastRenderMs||0;this.renderCost=this.renderCost?this.renderCost*.8+cost*.2:cost;this.metricFrames++;
    if(now-this.metricStart>1500){this.onStatus({available:true,renderer:this.rendererName,scene:'lobby',fps:Math.round(this.metricFrames*1000/(now-this.metricStart)),renderMs:Math.round(cost),triangles:this.renderer.info.render.triangles,cachedTriangles:this.renderer.info.render.cachedTriangles||0});this.metricStart=now;this.metricFrames=0;}
   }catch(error){this.stop();this.onStatus({available:false,renderer:this.rendererName,scene:'lobby',reason:'frame-error'});return;}
   if(!this.reduced||this.needsRender)this.frame=requestAnimationFrame(frame);else this.running=false;
  };this.frame=requestAnimationFrame(frame);
 }
 stop(){this.running=false;if(this.frame)cancelAnimationFrame(this.frame);this.frame=null;this.lastFrame=null;}
 dispose(){if(this.destroyed)return;this.stop();this.destroyed=true;this.down=null;this.observer?.disconnect();if(this.handlers){for(const [event,key]of[['pointerdown','down'],['pointermove','move'],['pointerup','up'],['pointercancel','cancel'],['lostpointercapture','cancel'],['pointerleave','cancel'],['webglcontextlost','lost'],['webglcontextrestored','restored']])this.canvas.removeEventListener(event,this.handlers[key]);window.removeEventListener('resize',this.handlers.resize);window.removeEventListener('blur',this.handlers.blur);}this.world?.dispose();this.textures?.dispose();this.renderer?.dispose();this.scene.clear();}
}
