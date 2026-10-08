import {Texture,CanvasTexture,SRGBColorSpace,LinearFilter} from 'three';
/** Original material swatches and a tiny procedural light sprite. */
export class LobbyTextures{
 constructor(onChange=()=>{}){this.items=new Map();this.images=[];this.disposed=false;for(const [key,file]of[['bark','grove-bark-v1.webp'],['moss','grove-moss-v1.webp']]){const texture=new Texture();texture.colorSpace=SRGBColorSpace;texture.minFilter=texture.magFilter=LinearFilter;texture.generateMipmaps=false;this.items.set(key,texture);if(typeof Image==='function'){const image=new Image();image.decoding='async';image.onload=()=>{if(this.disposed)return;texture.image=image;texture.needsUpdate=true;onChange();};image.onerror=()=>{if(!this.disposed)onChange();};image.src='/assets/materials/'+file;this.images.push(image);}}
  for(const kind of['light','shadow']){const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d'),g=ctx.createRadialGradient(32,32,1,32,32,31);if(kind==='light'){g.addColorStop(0,'rgba(255,247,182,.95)');g.addColorStop(.16,'rgba(255,215,111,.56)');g.addColorStop(.55,'rgba(241,180,76,.10)');g.addColorStop(1,'rgba(241,180,76,0)');}else{g.addColorStop(0,'rgba(2,16,12,.73)');g.addColorStop(.4,'rgba(2,16,12,.41)');g.addColorStop(1,'rgba(2,16,12,0)');}ctx.fillStyle=g;ctx.fillRect(0,0,64,64);const texture=new CanvasTexture(canvas);texture.minFilter=texture.magFilter=LinearFilter;texture.generateMipmaps=false;this.items.set(kind,texture);}
 }
 get(key){return this.items.get(key);}
 dispose(){if(this.disposed)return;this.disposed=true;this.images.forEach(x=>{x.onload=x.onerror=null;});this.images=[];this.items.forEach(t=>t.dispose());this.items.clear();}
}
