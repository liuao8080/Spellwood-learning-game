import { Scene, PerspectiveCamera, WebGLRenderer, Color, Mesh, CylinderGeometry, MeshStandardMaterial, SRGBColorSpace, HemisphereLight, DirectionalLight, ACESFilmicToneMapping } from 'three';
import { SoftwareRenderer } from '../arena3d/software-renderer.mjs';
import { createHeroModel } from '../arena3d/hero-models.mjs';
import { getHeroSkin } from '../hero-skins.mjs';
/** One hero at a time: medium for a WebGL close view, low for CPU. No idle loop. */
export class HeroPreview {
  constructor({canvas, reduced=false, onStatus=()=>{}}) {
    Object.assign(this,{canvas,reduced,onStatus});this.hidden=false;this.disposed=false;this.frame=null;this.skinId=null;
    this.scene=new Scene();this.scene.background=new Color('#071b20');
    // Standard hero materials need real scene lights on the WebGL path.
    this.scene.add(new HemisphereLight(0xd6e7ce,0x233a2e,1.8));
    const key=new DirectionalLight(0xffe1ae,3);key.position.set(-3,5,4);this.scene.add(key);
    const rim=new DirectionalLight(0x91bfd5,1.2);rim.position.set(3,3,-2);this.scene.add(rim);
    this.camera=new PerspectiveCamera(31,1,.1,40);this.camera.position.set(0,1.28,5.8);this.camera.lookAt(0,.95,0);
    try { this.renderer=new WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});this.renderer.outputColorSpace=SRGBColorSpace;this.renderer.toneMapping=ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.08;this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,1.5)); }
    catch { try { this.renderer=new SoftwareRenderer(canvas); } catch { onStatus({available:false}); return; } }
    this.pedestal=new Mesh(new CylinderGeometry(.75,.88,.16,24),new MeshStandardMaterial({color:'#49604e',roughness:.88,metalness:0}));this.pedestal.position.y=-.12;this.scene.add(this.pedestal);
    this.observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>this.resize()):null;this.observer?.observe(canvas);this.resize();this.diagnostics();onStatus({available:!!this.renderer});
  }
  diagnostics(){
    const data=this.canvas?.dataset;if(!data)return;
    data.renderer=this.renderer?(this.renderer.isSoftwareRenderer?'CPU · 兼容三维':'WebGL2'):'unavailable';
    data.skinId=this.model&&!this.model.disposed?this.model.skinId:'';
    data.modelCount=String(this.scene.children.filter(child=>!!child.userData?.skinId).length);
    data.triangles=String(this.model&&!this.model.disposed?this.model.metrics.triangles:0);
    data.modelQuality=this.model&&!this.model.disposed?this.model.metrics.quality:'';
  }
  setSkin(id,{reveal=false}={}) {
    if(this.disposed||!this.renderer)return;id=getHeroSkin(id).id;
    if(id===this.skinId&&!reveal){this.draw();return;}
    if(id!==this.skinId){this.model?.dispose();try{this.model=createHeroModel(id,{quality:this.renderer.isSoftwareRenderer?'low':'medium'});this.skinId=id;this.scene.add(this.model.root);}catch{this.fail();return;}}
    this.diagnostics();cancelAnimationFrame(this.frame);this.frame=null;this.model.root.rotation.y=-.2;
    if(reveal&&!this.reduced&&!this.renderer.isSoftwareRenderer&&!this.hidden){this.start=performance.now();this.tick(this.start);}else this.draw();
  }
  tick(now){if(this.hidden||this.disposed)return;const t=Math.min(1,(now-this.start)/650);this.model.root.rotation.y=-.7+.5*(1-(1-t)**3);this.draw();if(t<1&&this.renderer)this.frame=requestAnimationFrame(value=>this.tick(value));else this.frame=null;}
  fail(){cancelAnimationFrame(this.frame);this.frame=null;this.renderer?.dispose();this.renderer=null;this.diagnostics();this.onStatus({available:false});}
  draw(){if(!this.hidden&&!this.disposed&&this.renderer){try{this.renderer.render(this.scene,this.camera);}catch{this.fail();}}}
  resize(){if(!this.renderer||this.disposed)return;const rect=this.canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();const scale=this.renderer.isSoftwareRenderer?Math.min(1,420/w,400/h):1;this.renderer.setSize(w*scale,h*scale,false);this.draw();}
  skip(){cancelAnimationFrame(this.frame);this.frame=null;if(this.model)this.model.root.rotation.y=-.2;this.draw();}
  setHidden(hidden){this.hidden=!!hidden;if(hidden){cancelAnimationFrame(this.frame);this.frame=null;}else this.draw();}
  setReduced(value){this.reduced=!!value;if(value){cancelAnimationFrame(this.frame);this.frame=null;this.draw();}}
  dispose(){if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.frame);this.observer?.disconnect();this.model?.dispose();this.pedestal?.geometry.dispose();this.pedestal?.material.dispose();this.renderer?.dispose();this.renderer=null;this.scene.clear();this.diagnostics();}
}
