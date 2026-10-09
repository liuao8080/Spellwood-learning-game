import { Color } from 'three';

const clamp = (v, low=0, high=1) => Math.min(high,Math.max(low,v));

/** Stable seam occlusion on existing vertices, not a painted light direction.
 * No geometry, material, texture, pose or draw-call changes are introduced. */
export function shadeRangerGarment(geometry, region) {
  const p=geometry.getAttribute('position'), colors=geometry.getAttribute('color'), color=new Color();
  for(let i=0;i<p.count;i++) {
    const x=Math.abs(p.getX(i)), y=p.getY(i), z=p.getZ(i);
    let scale=1;
    if(region==='tunic') {
      const hem=clamp((.61-y)/.13), collar=clamp((y-1.15)/.17);
      const waist=clamp(1-Math.abs(y-.885)/.15);
      const side=clamp((x-.17)/.18);
      scale=1-.25*hem-.22*collar-.10*waist-.07*side;
    } else if(region==='sleeve') {
      const inner=clamp((.38-x)/.16), under=clamp((1.2-y)/.19);
      scale=1-.22*inner*under-.10*clamp((1.02-y)/.16);
    } else if(region==='boot') {
      // Existing sole vertices already have a darker base; keep a readable welt,
      // warmer toe plane and dark opening without a new ring or overlay.
      scale=y<.065?.72:y>.30?.66:y>.20?.89:1+.12*clamp((z-.03)/.17);
    } else if(region==='belt') scale=y<.91?.72:1.04;
    else if(region==='collar') scale=.76+.24*clamp((y-1.25)/.09);
    color.fromBufferAttribute(colors,i).multiplyScalar(scale);
    color.toArray(colors.array,i*3);
  }
  colors.needsUpdate=true;
  return geometry;
}
