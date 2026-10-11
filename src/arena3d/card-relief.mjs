/** Baked bevel shading inside the existing face canvas. No extra GPU resources. */
export function paintFrameRelief(ctx, inset, radius, palette) {
  const light=ctx.createLinearGradient(0,0,512,720);
  light.addColorStop(0,palette[0]); light.addColorStop(.32,palette[2]);
  light.addColorStop(.63,palette[1]); light.addColorStop(1,palette[3]);
  ctx.save();ctx.lineJoin='round';
  ctx.strokeStyle=light;ctx.lineWidth=inset-3;
  ctx.beginPath();ctx.roundRect(inset/2,inset/2,512-inset,720-inset,radius-inset/2);ctx.stroke();
  // Raised outside lip, then the shaded inner cut. Stay within the old border.
  ctx.strokeStyle='rgba(255,250,219,.52)';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.roundRect(2,2,508,716,radius-2);ctx.stroke();
  ctx.strokeStyle='rgba(29,26,14,.75)';ctx.lineWidth=2;
  ctx.beginPath();ctx.roundRect(inset-1,inset-1,514-2*inset,722-2*inset,radius-inset+1);ctx.stroke();
  ctx.restore();
}

/** Preserve the original medallion footprint and a quiet, dark number field. */
export function paintMedallionRelief(ctx,x,y,r,fill,rim,lineWidth) {
  ctx.save();
  const edge=ctx.createLinearGradient(x-r,y-r,x+r,y+r);
  edge.addColorStop(0,'#fff8d9');edge.addColorStop(.3,rim);
  edge.addColorStop(.64,'#9c885c');edge.addColorStop(1,'#393429');
  ctx.fillStyle=edge;ctx.beginPath();ctx.arc(x,y,r+lineWidth/2,0,Math.PI*2);ctx.fill();
  const inset=ctx.createLinearGradient(x-r,y-r,x+r,y+r);
  inset.addColorStop(0,'#172c29');inset.addColorStop(1,rim);
  ctx.fillStyle=inset;ctx.beginPath();ctx.arc(x,y,r-2,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=fill;ctx.beginPath();ctx.arc(x,y,r-5,0,Math.PI*2);ctx.fill();
  ctx.restore();
}
