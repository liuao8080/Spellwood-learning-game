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
      // Broad regions intentionally span the existing sparse lathe rings.
      // Narrow bands vanish when their only vertices sit behind the belt/collar.
      const hem=clamp((.66-y)/.18), collar=clamp((y-.98)/.32);
      const waist=clamp(1-Math.abs(y-.90)/.24);
      const side=clamp((x-.17)/.18);
      scale=Math.max(.30,1-.56*hem-.38*collar-.36*waist-.13*side);
    } else if(region==='sleeve') {
      const inner=clamp((.50-x)/.30), under=clamp((1.38-y)/.38);
      scale=Math.max(.38,1-.45*inner-.23*under-.18*clamp((1.01-y)/.20));
    } else if(region==='boot') {
      // Existing sole vertices already have a darker base; keep a readable welt,
      // warmer toe plane and dark opening without a new ring or overlay.
      scale=y<.065?.50:y>.30?.42:y>.20?.65:1+.32*clamp((z-.03)/.17);
    } else if(region==='belt') scale=y<.91?.42:1.20;
    else if(region==='collar') scale=.38+.62*clamp((y-1.245)/.12);
    color.fromBufferAttribute(colors,i).multiplyScalar(scale);
    color.toArray(colors.array,i*3);
  }
  colors.needsUpdate=true;
  return geometry;
}
