/** CPU compatibility renderer for browsers without WebGL.
 * Renders the same Three.js geometry/camera. No browser flags or GPU APIs.
 * Authored vertex-normal lighting and a CPU depth buffer; no GPU shadows.
 */
import { Matrix4, Matrix3, Vector3, Color, DoubleSide, BackSide } from "three";

// Linear-to-display lookup keeps curved shading out of the per-pixel hot path.
const DISPLAY = Uint8Array.from({ length: 4097 }, (_, i) => {
  const v = i / 4096;
  return Math.round(255 * (v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055));
});
const display = v => DISPLAY[Math.max(0, Math.min(4096, Math.round(v * 4096)))];

export class SoftwareRenderer {
  constructor(canvas) {
    this.domElement = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    if (!this.context) throw Error("Canvas compatibility rendering unavailable");
    this.isSoftwareRenderer = true;
    this.shadowMap = {};
    this.info = { render: { triangles: 0, calls: 0 } };
    this.cache = new WeakMap(); this.textureCache = new WeakMap();
    this.viewProjection = new Matrix4(); this.transform = new Matrix4(); this.normalMatrix = new Matrix3();
    this.light = new Vector3(-.4, .83, .38).normalize();
    this.highlight = new Vector3(-.2, .69, .69).normalize();
    this.color = new Color(); this.point = new Vector3(); this.normal = new Vector3(); this.position = new Vector3(); this.scale = new Vector3();
    this.width = 1; this.height = 1;
  }
  setPixelRatio() {} // Keep compatibility input/pixel work bounded on high-DPI screens.
  setSize(width, height) {
    width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));
    if(this.frame && this.width===width && this.height===height)return;
    this.width = width; this.height = height;
    this.domElement.width = this.width; this.domElement.height = this.height;
    this.staticFrame = null;
    this.frame = this.context.createImageData(this.width, this.height);
    this.pixels = new Uint32Array(this.frame.data.buffer); this.depths = new Float32Array(this.width * this.height);
  }
  dispose() { this.cache = new WeakMap(); this.textureCache = new WeakMap(); this.staticFrame = null; this.frame = this.pixels = this.depths = null; }
  geometryData(geometry) {
    let data = this.cache.get(geometry);
    const position = geometry.attributes.position;
    if (!data || data.count !== position.count) {
      data = { count: position.count, projected: new Float32Array(position.count * 4), shades: new Float32Array(position.count * 3) };
      this.cache.set(geometry, data);
    }
    return data;
  }
  render(scene, camera) {
    const start = performance.now();
    scene.updateMatrixWorld(); camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const commands = [], staticCommands = [], w = this.width, h = this.height;
    let staticRoot = null;
    scene.traverseVisible(object => { if (!staticRoot && object.userData.cpuStatic) staticRoot = object; });
    const staticKey = staticRoot ? [...this.viewProjection.elements, ...staticRoot.matrixWorld.elements].join(",") : null;
    const reuseStatic = staticKey && this.staticFrame?.root === staticRoot && this.staticFrame?.key === staticKey;
    if (!staticRoot) this.staticFrame = null;
    const ctx = this.context;
    if (reuseStatic) { this.pixels.set(this.staticFrame.pixels); this.depths.set(this.staticFrame.depths); }
    else { this.pixels.fill(0xff201b07); this.depths.fill(Infinity); }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#071b20"; ctx.fillRect(0, 0, w, h);
    scene.traverseVisible(object => {
      if (reuseStatic && object.userData.cpuStatic) return;
      if (object.isSprite) { this.sprite(object, camera, commands); return; }
      if (object.isPoints) { this.points(object, commands); return; }
      if (object.isLineSegments) { this.lines(object, commands); return; }
      if (!object.isMesh || !object.geometry?.attributes.position) return;
      const geometry = object.geometry, pos = geometry.attributes.position, norms = geometry.attributes.normal;
      const colors = geometry.attributes.color, uv = geometry.attributes.uv, idx = geometry.index;
      const data = this.geometryData(geometry), points = data.projected;
      this.transform.multiplyMatrices(this.viewProjection, object.matrixWorld);
      this.normalMatrix.getNormalMatrix(object.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        this.point.fromBufferAttribute(pos, i).applyMatrix4(this.transform);
        points[i * 4] = (this.point.x + 1) * w / 2;
        points[i * 4 + 1] = (1 - this.point.y) * h / 2;
        points[i * 4 + 2] = this.point.z;
        const e = this.transform.elements; points[i * 4 + 3] = 1 / (e[3] * pos.getX(i) + e[7] * pos.getY(i) + e[11] * pos.getZ(i) + e[15]);
      }
      const groups = Array.isArray(object.material) ? geometry.groups : [{ start: 0, count: idx?.count ?? pos.count, materialIndex: 0 }];
      for (const group of groups) {
        const material = Array.isArray(object.material) ? object.material[group.materialIndex] : object.material;
        if (!material || !material.visible || material.opacity <= .005) continue;
        const image = material.map?.image;
        const texture = image && (image.width || image.naturalWidth) && uv ? this.textureData(material.map) : null;
        const smooth = material.userData.cpuSmooth && norms && (!texture || material.userData.cpuLitTexture) && !material.isMeshBasicMaterial;
        const shades = data.shades;
        if (smooth) {
          const base = material.color, emission = material.emissive, intensity = material.emissiveIntensity || 0;
          const specular = material.roughness < .4 ? .24 : .035;
          const lightingKey = [...this.normalMatrix.elements, base.r,base.g,base.b, emission?.r||0,emission?.g||0,emission?.b||0,intensity,specular,!!material.vertexColors,norms.version,colors?.version,this.light.x,this.light.y,this.light.z,this.highlight.x,this.highlight.y,this.highlight.z].join(',');
          if(data.lightingKey!==lightingKey || data.lightingNormals!==norms || data.lightingColors!==colors){
          data.lightingKey=lightingKey;data.lightingNormals=norms;data.lightingColors=colors;
          for (let i = 0; i < pos.count; i++) {
            this.normal.fromBufferAttribute(norms, i).applyNormalMatrix(this.normalMatrix);
            const diffuse = .38 + .72 * Math.max(0, this.normal.dot(this.light));
            const rim = .15 * Math.max(0, -this.normal.z);
            const shine = specular * Math.max(0, this.normal.dot(this.highlight)) ** 18;
            const r = base.r * (colors && material.vertexColors ? colors.getX(i) : 1);
            const g = base.g * (colors && material.vertexColors ? colors.getY(i) : 1);
            const b = base.b * (colors && material.vertexColors ? colors.getZ(i) : 1);
            shades[i * 3] = display(r * (diffuse * 1.025 + rim * .78) + shine + (emission?.r || 0) * intensity);
            shades[i * 3 + 1] = display(g * (diffuse + rim) + shine + (emission?.g || 0) * intensity);
            shades[i * 3 + 2] = display(b * (diffuse * .95 + rim * 1.2) + shine + (emission?.b || 0) * intensity);
          }
          }
        }
        const end = Math.min(group.start + group.count, idx?.count ?? pos.count);
        for (let offset = group.start; offset < end; offset += 3) {
          const a = idx ? idx.getX(offset) : offset, b = idx ? idx.getX(offset + 1) : offset + 1, c = idx ? idx.getX(offset + 2) : offset + 2;
          const ai = a * 4, bi = b * 4, ci = c * 4;
          const x0 = points[ai], y0 = points[ai + 1], z0 = points[ai + 2];
          const x1 = points[bi], y1 = points[bi + 1], z1 = points[bi + 2];
          const x2 = points[ci], y2 = points[ci + 1], z2 = points[ci + 2];
          if (z0 < -1 || z1 < -1 || z2 < -1 || z0 > 1 || z1 > 1 || z2 > 1) continue;
          if (Math.max(x0, x1, x2) < 0 || Math.min(x0, x1, x2) > w || Math.max(y0, y1, y2) < 0 || Math.min(y0, y1, y2) > h) continue;
          const cross = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
          if (Math.abs(cross) < .055 || (material.side !== DoubleSide && (material.side === BackSide ? cross < 0 : cross > 0))) continue;
          let light = 1;
          if (!smooth && !material.isMeshBasicMaterial && norms) {
            this.normal.fromBufferAttribute(norms, a).add(this.point.fromBufferAttribute(norms, b)).add(this.position.fromBufferAttribute(norms, c)).applyNormalMatrix(this.normalMatrix);
            if (cross > 0) this.normal.negate();
            light = .5 + .73 * Math.max(0, this.normal.dot(this.light)) + .12 * Math.max(0, -this.normal.z);
          }
          this.color.copy(material.color || new Color(0xffffff));
          if (colors && material.vertexColors) {
            this.color.r *= (colors.getX(a) + colors.getX(b) + colors.getX(c)) / 3;
            this.color.g *= (colors.getY(a) + colors.getY(b) + colors.getY(c)) / 3;
            this.color.b *= (colors.getZ(a) + colors.getZ(b) + colors.getZ(c)) / 3;
          }
          this.color.multiplyScalar(light);
          if (material.emissive) this.color.add(this.pointColor(material.emissive, material.emissiveIntensity || 0));
          (object.userData.cpuStatic ? staticCommands : commands).push({ kind: "triangle", depth: (z0 + z1 + z2) / 3, order: object.renderOrder || 0, alpha: material.opacity,
            x0, y0, x1, y1, x2, y2, z0, z1, z2, q0: points[ai + 3], q1: points[bi + 3], q2: points[ci + 3], color: this.color.getHex(), texture,
            shade: smooth ? [shades[a*3], shades[a*3+1], shades[a*3+2], shades[b*3], shades[b*3+1], shades[b*3+2], shades[c*3], shades[c*3+1], shades[c*3+2]] : null,
            uv: texture ? [uv.getX(a), 1 - uv.getY(a), uv.getX(b), 1 - uv.getY(b), uv.getX(c), 1 - uv.getY(c)] : null });
        }
      }
    });
    // Opaque and textured geometry use per-pixel depth, so tabletop/card layers
    // cannot cut through one another as they can with triangle-average sorting.
    let triangles = 0;
    if (!reuseStatic && staticKey) {
      for (const item of staticCommands) this.rasterize(item);
      this.staticFrame = { root: staticRoot, key: staticKey, pixels: this.pixels.slice(), depths: this.depths.slice(), triangles: staticCommands.length };
    }
    const translucent = [], overlays = [];
    for (const item of commands) {
      if (item.kind !== "triangle") { overlays.push(item); continue; }
      if (item.alpha < .995) translucent.push(item);
      else { this.rasterize(item); triangles++; }
    }
    translucent.sort((a,b) => b.depth - a.depth);
    for (const item of translucent) { this.rasterize(item); triangles++; }
    ctx.putImageData(this.frame, 0, 0);
    overlays.sort((a,b) => a.order - b.order || b.depth - a.depth);
    for (const item of overlays) {
      ctx.globalAlpha = item.alpha ?? 1;
      if (item.kind === "sprite") ctx.drawImage(item.image, item.x, item.y, item.width, item.height);
      else if (item.kind === "line") { ctx.strokeStyle = item.color; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(item.x, item.y); ctx.lineTo(item.x1, item.y1); ctx.stroke(); }
      else { ctx.fillStyle = item.color; ctx.beginPath(); ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    this.info.render = { triangles: triangles + (reuseStatic ? 0 : staticCommands.length), calls: commands.length + (reuseStatic ? 0 : staticCommands.length), cachedTriangles: this.staticFrame?.triangles || 0 };
    this.lastRenderMs = performance.now() - start;
  }
  pointColor(color, intensity) { return { r: color.r * intensity, g: color.g * intensity, b: color.b * intensity }; }
  textureData(texture) {
    const image = texture.image;
    let item = this.textureCache.get(image);
    if (!item || item.version !== texture.version) {
      const width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
      const bytes = context.getImageData(0, 0, width, height);
      item = { width, height, pixels: new Uint32Array(bytes.data.buffer), version: texture.version };
      this.textureCache.set(image, item);
    }
    return item;
  }
  rasterize(t){
    const w=this.width,h=this.height;
    const minX=Math.max(0,Math.floor(Math.min(t.x0,t.x1,t.x2))),maxX=Math.min(w-1,Math.ceil(Math.max(t.x0,t.x1,t.x2)));
    const minY=Math.max(0,Math.floor(Math.min(t.y0,t.y1,t.y2))),maxY=Math.min(h-1,Math.ceil(Math.max(t.y0,t.y1,t.y2)));
    if(t.texture||t.alpha<.995||(maxX-minX)*(maxY-minY)<100)return this.rasterizeGeneral(t);
    const denominator=(t.y1-t.y2)*(t.x0-t.x2)+(t.x2-t.x1)*(t.y0-t.y2);
    if(Math.abs(denominator)<.001)return;
    const dx0=(t.y1-t.y2)/denominator,dx1=(t.y2-t.y0)/denominator,dx2=-dx0-dx1;
    const dy0=(t.x2-t.x1)/denominator,dy1=(t.x0-t.x2)/denominator;
    let row0=dx0*(minX+.5-t.x2)+dy0*(minY+.5-t.y2),row1=dx1*(minX+.5-t.x2)+dy1*(minY+.5-t.y2);
    const pixel=(255<<24|(t.color&255)<<16|(t.color>>8&255)<<8|(t.color>>16&255))>>>0;
    const dz=dx0*t.z0+dx1*t.z1+dx2*t.z2,epsilon=.000001;
    const s=t.shade,dr=s?dx0*s[0]+dx1*s[3]+dx2*s[6]:0,dg=s?dx0*s[1]+dx1*s[4]+dx2*s[7]:0,db=s?dx0*s[2]+dx1*s[5]+dx2*s[8]:0;
    for(let y=minY;y<=maxY;y++,row0+=dy0,row1+=dy1){
      let lo=0,hi=maxX-minX;const row2=1-row0-row1;
      if(dx0>0)lo=Math.max(lo,Math.ceil((-epsilon-row0)/dx0));else if(dx0<0)hi=Math.min(hi,Math.floor((-epsilon-row0)/dx0));else if(row0 < -epsilon)continue;
      if(dx1>0)lo=Math.max(lo,Math.ceil((-epsilon-row1)/dx1));else if(dx1<0)hi=Math.min(hi,Math.floor((-epsilon-row1)/dx1));else if(row1 < -epsilon)continue;
      if(dx2>0)lo=Math.max(lo,Math.ceil((-epsilon-row2)/dx2));else if(dx2<0)hi=Math.min(hi,Math.floor((-epsilon-row2)/dx2));else if(row2 < -epsilon)continue;
      const a=row0+dx0*lo,b=row1+dx1*lo;
      let z=a*t.z0+b*t.z1+(1-a-b)*t.z2,index=y*w+minX+lo;
      if(s){
        const c=1-a-b;let r=a*s[0]+b*s[3]+c*s[6],g=a*s[1]+b*s[4]+c*s[7],blue=a*s[2]+b*s[5]+c*s[8];
        for(let x=lo;x<=hi;x++,index++,z+=dz,r+=dr,g+=dg,blue+=db){if(z<this.depths[index]){this.pixels[index]=(255<<24|Math.round(blue)<<16|Math.round(g)<<8|Math.round(r))>>>0;this.depths[index]=z;}}
      }else for(let x=lo;x<=hi;x++,index++,z+=dz){if(z<this.depths[index]){this.pixels[index]=pixel;this.depths[index]=z;}}
    }
  }
  rasterizeGeneral(t) {
    const w = this.width, h = this.height;
    const minX = Math.max(0, Math.floor(Math.min(t.x0, t.x1, t.x2))), maxX = Math.min(w - 1, Math.ceil(Math.max(t.x0, t.x1, t.x2)));
    const minY = Math.max(0, Math.floor(Math.min(t.y0, t.y1, t.y2))), maxY = Math.min(h - 1, Math.ceil(Math.max(t.y0, t.y1, t.y2)));
    const denominator = (t.y1 - t.y2) * (t.x0 - t.x2) + (t.x2 - t.x1) * (t.y0 - t.y2);
    if (Math.abs(denominator) < .001) return;
    // Shared edges belong to one triangle, avoiding double alpha blending.
    const halfOpen = t.alpha < .995 || !!t.texture, sign = Math.sign(denominator);
    const topLeft = (x0,y0,x1,y1) => (y1-y0)*sign < 0 || (y1 === y0 && (x1-x0)*sign > 0);
    const edge0 = topLeft(t.x1,t.y1,t.x2,t.y2), edge1 = topLeft(t.x2,t.y2,t.x0,t.y0), edge2 = topLeft(t.x0,t.y0,t.x1,t.y1);
    const dx0 = (t.y1 - t.y2) / denominator, dx1 = (t.y2 - t.y0) / denominator;
    const dy0 = (t.x2 - t.x1) / denominator, dy1 = (t.x0 - t.x2) / denominator;
    let row0 = dx0 * (minX + .5 - t.x2) + dy0 * (minY + .5 - t.y2);
    let row1 = dx1 * (minX + .5 - t.x2) + dy1 * (minY + .5 - t.y2);
    const red = t.color >> 16 & 255, green = t.color >> 8 & 255, blue = t.color & 255;
    const color = (255 << 24 | blue << 16 | green << 8 | red) >>> 0;
    for (let y = minY; y <= maxY; y++, row0 += dy0, row1 += dy1) {
      let a = row0, b = row1, index = y * w + minX;
      for (let x = minX; x <= maxX; x++, index++, a += dx0, b += dx1) {
        const c = 1 - a - b;
        if (a < -.000001 || b < -.000001 || c < -.000001) continue;
        if (halfOpen && ((Math.abs(a) <= 1e-10 && !edge0) || (Math.abs(b) <= 1e-10 && !edge1) || (Math.abs(c) <= 1e-10 && !edge2))) continue;
        const z = a * t.z0 + b * t.z1 + c * t.z2;
        if (z >= this.depths[index]) continue;
        let pixel = color, alpha = t.alpha;
        if (t.shade) {
          const s=t.shade;
          pixel=(255<<24|Math.round(a*s[2]+b*s[5]+c*s[8])<<16|Math.round(a*s[1]+b*s[4]+c*s[7])<<8|Math.round(a*s[0]+b*s[3]+c*s[6]))>>>0;
        }
        if (t.texture) {
          const q = a * t.q0 + b * t.q1 + c * t.q2;
          const u = (a * t.uv[0] * t.q0 + b * t.uv[2] * t.q1 + c * t.uv[4] * t.q2) / q;
          const v = (a * t.uv[1] * t.q0 + b * t.uv[3] * t.q1 + c * t.uv[5] * t.q2) / q;
          const tx = Math.max(0, Math.min(t.texture.width - 1, Math.floor(u * t.texture.width)));
          const ty = Math.max(0, Math.min(t.texture.height - 1, Math.floor(v * t.texture.height)));
          pixel = t.texture.pixels[ty * t.texture.width + tx]; alpha *= (pixel >>> 24) / 255;
          if(t.shade){const s=t.shade;const r=Math.round((pixel&255)*(a*s[0]+b*s[3]+c*s[6])/255),g=Math.round((pixel>>8&255)*(a*s[1]+b*s[4]+c*s[7])/255),blue=Math.round((pixel>>16&255)*(a*s[2]+b*s[5]+c*s[8])/255);pixel=(255<<24|blue<<16|g<<8|r)>>>0;}
        }
        if (alpha < .01) continue;
        if (alpha >= .995) { this.pixels[index] = pixel; this.depths[index] = z; }
        else {
          const old = this.pixels[index], inverse = 1 - alpha;
          const r = Math.round((pixel & 255) * alpha + (old & 255) * inverse);
          const g = Math.round((pixel >> 8 & 255) * alpha + (old >> 8 & 255) * inverse);
          const b = Math.round((pixel >> 16 & 255) * alpha + (old >> 16 & 255) * inverse);
          this.pixels[index] = (255 << 24 | b << 16 | g << 8 | r) >>> 0;
        }
      }
    }
  }
  sprite(object, camera, commands) {
    const image = object.material?.map?.image;
    if (!image || !object.material.visible || object.material.opacity <= .005) return;
    object.getWorldPosition(this.position); this.point.copy(this.position).project(camera); object.getWorldScale(this.scale);
    if (this.point.z < -1 || this.point.z > 1) return;
    const distance = this.position.applyMatrix4(camera.matrixWorldInverse).z;
    const factor = this.height / (2 * Math.tan(camera.fov * Math.PI / 360) * -distance);
    const width = Math.abs(this.scale.x * factor), height = Math.abs(this.scale.y * factor);
    commands.push({ kind: "sprite", depth: this.point.z, order: object.renderOrder || 0, alpha: object.material.opacity, image,
      x: (this.point.x + 1) * this.width / 2 - width * object.center.x, y: (1 - this.point.y) * this.height / 2 - height * (1 - object.center.y), width, height });
  }
  points(object, commands) {
    const material = object.material, pos = object.geometry.attributes.position;
    if (!material?.visible || material.opacity <= .005) return;
    this.transform.multiplyMatrices(this.viewProjection, object.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      this.point.fromBufferAttribute(pos, i).applyMatrix4(this.transform);
      if (Math.abs(this.point.x) > 1.1 || Math.abs(this.point.y) > 1.1 || Math.abs(this.point.z) > 1) continue;
      commands.push({ kind: "dot", depth: this.point.z, order: object.renderOrder || 0, alpha: material.opacity, color: material.color.getStyle(),
        x: (this.point.x + 1) * this.width / 2, y: (1 - this.point.y) * this.height / 2, radius: Math.max(1.2, material.size * 19) });
    }
  }
  lines(object, commands) {
    const material = object.material, pos = object.geometry.attributes.position;
    if (!material?.visible || material.opacity <= .005) return;
    this.transform.multiplyMatrices(this.viewProjection, object.matrixWorld);
    for (let i = 0; i + 1 < pos.count; i += 2) {
      this.point.fromBufferAttribute(pos, i).applyMatrix4(this.transform); this.position.fromBufferAttribute(pos, i + 1).applyMatrix4(this.transform);
      commands.push({ kind: "line", depth: (this.point.z + this.position.z) / 2, order: object.renderOrder || 0, alpha: material.opacity, color: material.color.getStyle(),
        x: (this.point.x + 1) * this.width / 2, y: (1 - this.point.y) * this.height / 2, x1: (this.position.x + 1) * this.width / 2, y1: (1 - this.position.y) * this.height / 2 });
    }
  }
}
