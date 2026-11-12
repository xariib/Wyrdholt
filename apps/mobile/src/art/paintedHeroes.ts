import type { ArtAsset, Pose } from "./types";
import type { GearSkin, HeroAppearance, HeroClass } from "./gearSkins";
import { HERO_RESOLUTION, PAINTED_SHEETS } from "./paintedSources";
export { HERO_RESOLUTION } from "./paintedSources";
const R = HERO_RESOLUTION;
type Point = readonly [number, number];
type Part = "chest" | "gloves" | "boots";
const images = new Map<string, HTMLImageElement>();
const loading = new Map<string, Promise<void>>();
const outfits = new Map<string, HTMLCanvasElement>();
const accessories = new Map<string, HTMLCanvasElement>();
const MAX_OUTFITS = 8;
export function paintedReady(cls: HeroClass): boolean { return images.has(cls) && images.has("weapons") && images.has("headgear"); }
export function paintedDecodedBytes(): number {
  return [...images.values()].reduce((n, i) => n + i.naturalWidth * i.naturalHeight * 4, 0)
    + [...outfits.values(), ...accessories.values()].reduce((n, c) => n + c.width * c.height * 4, 0);
}
function loadImage(key: string): Promise<void> {
  if (images.has(key)) return Promise.resolve();
  const existing = loading.get(key); if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => finish(new Error(`Painted art timeout: ${key}`)), 10000);
    function finish(error?: Error) {
      clearTimeout(timer); image.onload = null; image.onerror = null;
      if (error) { image.src = ""; loading.delete(key); reject(error); }
      else { images.set(key, image); resolve(); }
    }
    image.onload = () => {
      const expected = PAINTED_SHEETS[key]!;
      if (image.naturalWidth !== expected.width || image.naturalHeight !== expected.height) finish(new Error(`Invalid painted atlas: ${key}`));
      else finish();
    };
    image.onerror = () => finish(new Error(`Painted art unavailable: ${key}`));
    image.src = `${import.meta.env.BASE_URL}${PAINTED_SHEETS[key]!.file}`;
  });
  loading.set(key, promise); return promise;
}
export async function loadPaintedHero(cls: HeroClass): Promise<void> {
  await Promise.all([loadImage(cls), loadImage("weapons"), loadImage("headgear")]);
}
function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}
function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; return ctx;
}
function poly(ctx: CanvasRenderingContext2D, points: readonly Point[]) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
}
const hands: Record<HeroClass, readonly [Point, Point]> = {
  warrior: [[-6.2, -23.8], [9.3, -23.8]], monk: [[-4.6, -36.2], [5.3, -30.2]],
  mage: [[-1.2, -29.5], [9, -28.8]], ranger: [[-5, -24.4], [7.8, -24.4]],
};
const heads: Record<HeroClass, number> = { warrior: -46, monk: -44, mage: -48, ranger: -46 };
const cuffs: Record<HeroClass, readonly (readonly Point[])[]> = {
  warrior: [[[-8.9,-30.5],[-4.6,-29.7],[-3.7,-21.5],[-8.1,-21.1]],[[6,-30.5],[10,-31],[12,-22],[8,-21]]],
  monk: [[[-9,-33],[-5.6,-37.3],[-3.4,-35.6],[-6.2,-31]],[[3.2,-31.5],[7,-33.5],[9,-31.2],[5.7,-28.7]]],
  mage: [[[-4.8,-32],[1.3,-31.6],[2,-27],[-3,-27]],[[6,-32],[10,-32],[12,-26],[8,-25.5]]],
  ranger: [[[-7.7,-30.5],[-4.4,-30.5],[-2.9,-22.4],[-6.6,-22]],[[4.6,-30.7],[7.8,-31.8],[10,-22.5],[7.4,-22]]],
};
function partPath(ctx: CanvasRenderingContext2D, cls: HeroClass, part: Part) {
  if (part === "gloves") {
    for (const points of cuffs[cls]) { poly(ctx, points); ctx.fill(); }
  } else if (part === "boots") ctx.fillRect(-24, cls === "mage" ? -3.5 : -10.5, 48, 12);
  else {
    ctx.fillRect(-24, heads[cls] + 5.6, 48, 60);
    ctx.globalCompositeOperation = "destination-out";
    partPath(ctx, cls, "gloves"); partPath(ctx, cls, "boots");
  }
}
function mask(cls: HeroClass, part: Part): HTMLCanvasElement {
  const c = canvas(192, 256), ctx = context(c); ctx.scale(R,R); ctx.translate(24,60); partPath(ctx,cls,part); return c;
}
function seed(s: GearSkin): number { return [...s.family].reduce((n,c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7); }
function material(c: HTMLCanvasElement, s: GearSkin) {
  const ctx = context(c);
  // The paint's luminance and brushwork survive the material tint. Named variants
  // have a stable dye variation in addition to their family's trim colour.
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = 0.045 + s.tier * 0.025 + (seed(s) % 65521) / 655210;
  ctx.fillStyle = s.base; ctx.fillRect(0,0,c.width,c.height);
  ctx.globalAlpha = 0.025 + (seed(s) % 997) / 19940; ctx.fillStyle = s.trim;
  ctx.fillRect(0,0,c.width,c.height); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
}
function clothing(cls: HeroClass, part: Part, skin: GearSkin): HTMLCanvasElement {
  const c = canvas(192,256), ctx = context(c), image = images.get(cls)!;
  const equipped = part !== "chest" || skin.tier >= 2;
  ctx.drawImage(image, equipped ? 192 : 0,0,192,256,0,0,192,256);
  ctx.globalCompositeOperation = "destination-in"; ctx.drawImage(mask(cls,part),0,0);
  ctx.globalCompositeOperation = "source-over"; material(c,skin); return c;
}
function body(look: HeroAppearance): HTMLCanvasElement {
  // Include slot values rather than trusting a caller-supplied display key.
  const key = `${look.classId}:${Object.values(look.slots).map(s=>s.id).sort().join("|")}`;
  const existing = outfits.get(key); if (existing) return existing;
  const c = canvas(192,256), ctx = context(c);
  ctx.drawImage(images.get(look.classId)!,0,0,192,256,0,0,192,256);
  for (const part of ["chest","gloves","boots"] as const) {
    const skin = look.slots[part]; if (!skin) continue;
    ctx.globalCompositeOperation = "destination-out"; ctx.drawImage(mask(look.classId,part),0,0);
    ctx.globalCompositeOperation = "source-over"; ctx.drawImage(clothing(look.classId,part,skin),0,0);
  }
  if (outfits.size >= MAX_OUTFITS) outfits.delete(outfits.keys().next().value!);
  outfits.set(key,c); return c;
}
function accessory(sheet: "weapons" | "headgear", index: number, s: GearSkin): HTMLCanvasElement {
  const key = `${sheet}:${s.id}`, existing = accessories.get(key); if (existing) return existing;
  const height = sheet === "weapons" ? 256 : 128, c = canvas(128,height),ctx = context(c);
  if(s.family === "watch_helm") ctx.filter = "grayscale(1) contrast(1.2)";
  ctx.drawImage(images.get(sheet)!,index*128,0,128,height,0,0,128,height);ctx.filter="none";
  material(c,s);
  if(accessories.size>=32)accessories.delete(accessories.keys().next().value!);
  accessories.set(key,c);return c;
}
function headpiece(ctx: CanvasRenderingContext2D, s: GearSkin) {
  const index = s.tier === 0 ? (s.classId === "monk" ? 1 : 0) : s.tier === 1 ? 1 : s.tier === 2 ? 2 : 3;
  const hood = index === 0;
  const y = heads[s.classId];
  ctx.drawImage(accessory("headgear",index,s),hood ? -5.1 : -3.8,y-(hood ? 3.2 : 5),hood ? 11.4 : 8,hood ? 11.4 : 8);
}
function weapon(ctx: CanvasRenderingContext2D, s: GearSkin, hand: Point, strike: boolean) {
  ctx.save(); ctx.translate(...hand);
  if (s.classId === "monk") {
    ctx.rotate(-0.25); ctx.fillStyle = s.shade; ctx.fillRect(-1.2,-1.2,3,2.8);
    ctx.strokeStyle = s.light; ctx.lineWidth = 0.5;
    for (const y of [-0.7,0.2,1.1]) {ctx.beginPath();ctx.moveTo(-1.1,y);ctx.lineTo(1.8,y+0.3);ctx.stroke();}
    ctx.fillStyle=s.trim;ctx.fillRect(1,-0.6,0.5,1.6);
  } else {
    const index = s.classId === "warrior" ? 0 : s.classId === "mage" ? 1 : 2;
    if (s.classId === "warrior") ctx.rotate(strike ? 0.95 : 0.14);
    if (s.classId === "mage") ctx.rotate(strike ? 0.24 : 0.04);
    // Grip positions are measured from the painted equipment sheet.
    const height = s.classId === "mage" ? 39 : s.classId === "warrior" && strike ? 25 : 29;
    const width = height / 2;
    ctx.drawImage(accessory("weapons",index,s),-width/2,-height*(s.classId === "warrior" ? 0.77 : 0.5),width,height);
    ctx.fillStyle = s.trim; ctx.beginPath();ctx.ellipse(0,-1,0.6,1.2,0,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}
function transformPoint(x:number,y:number,look:HeroAppearance,pose:Pose|"flash",frame:number):Point {
  const breath = pose === "idle" ? [0,-0.35,-0.65,-0.25][frame % 4]! : 0;
  const amount = pose === "attack" ? [-0.2,1,0.65,0.12][frame % 4]! : 0;
  const upper = Math.max(0,Math.min(1,(-y-8)/26));
  let dx = amount * upper * 1.5, dy = breath*upper + Math.max(0,amount)*upper*0.8;
  const [hx,hy] = hands[look.classId][1];
  const handWeight = Math.exp(-(((x-hx)/5.5)**2+((y-hy)/7)**2)*1.5);
  dx += amount*handWeight*(look.slots.weapon?.classId === "mage" ? 3 : 7);
  dy -= amount*handWeight*(look.classId === "monk" ? 1.4 : 5.5);
  if (pose === "hit" || pose === "flash") { dx -= upper*(frame ? 1 : 2);dy+=upper*0.5; }
  return [x+dx,y+dy];
}
/** Small affine patches animate the painted cutout without replacing it with drawn body parts. */
function deform(ctx:CanvasRenderingContext2D, source:HTMLCanvasElement, look:HeroAppearance,pose:Pose|"flash",frame:number) {
  const step=4;
  const point=(x:number,y:number)=>transformPoint(x-24,y-60,look,pose,frame);
  function triangle(src:readonly Point[], dst:readonly Point[]) {
    const [a,b,c]=src as readonly [Point,Point,Point], [p,q,r]=dst as readonly [Point,Point,Point];
    const ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-a[0],vy=c[1]-a[1],det=ux*vy-uy*vx;
    const aa=((q[0]-p[0])*vy-(r[0]-p[0])*uy)/det,bb=((q[1]-p[1])*vy-(r[1]-p[1])*uy)/det;
    const cc=((r[0]-p[0])*ux-(q[0]-p[0])*vx)/det,dd=((r[1]-p[1])*ux-(q[1]-p[1])*vx)/det;
    ctx.save();
    // Subpixel overlap prevents antialiased cracks between adjacent patches.
    const cx=(p[0]+q[0]+r[0])/3,cy=(p[1]+q[1]+r[1])/3;
    poly(ctx,dst.map(([x,y])=>[cx+(x-cx)*1.025,cy+(y-cy)*1.025] as Point));ctx.clip();
    ctx.transform(aa,bb,cc,dd,p[0]-aa*a[0]-cc*a[1],p[1]-bb*a[0]-dd*a[1]);
    ctx.drawImage(source,0,0,48,64);ctx.restore();
  }
  if (pose === "idle" && frame === 0) {ctx.drawImage(source,-24,-60,48,64);return;}
  for(let y=0;y<64;y+=step)for(let x=0;x<48;x+=step){
    const a:Point=[x,y],b:Point=[x+step,y],c:Point=[x,y+step],d:Point=[x+step,y+step];
    triangle([a,b,c],[point(...a),point(...b),point(...c)]);
    triangle([b,d,c],[point(...b),point(...d),point(...c)]);
  }
}
function draw(ctx:CanvasRenderingContext2D,look:HeroAppearance,pose:Pose|"flash",frame:number) {
  ctx.save();
  if(pose==="death") {
    const angle=[0,-0.3,-1.1,-Math.PI/2][frame]??-Math.PI/2;
    ctx.translate(frame>=2?22:0,frame>=2?-12:-frame*3);ctx.rotate(angle);
  }
  const hood=look.slots.head?.tier===0 && look.classId!=="monk";
  if(hood)headpiece(ctx,look.slots.head!);
  deform(ctx,body(look),look,pose,frame);
  if(look.slots.head&&!hood){
    const p=transformPoint(0,heads[look.classId],look,pose,frame);
    ctx.save();ctx.translate(p[0],p[1]-heads[look.classId]);headpiece(ctx,look.slots.head);ctx.restore();
  }
  if(look.slots.weapon) {
    const hand=hands[look.classId][1],p=transformPoint(...hand,look,pose,frame);
    weapon(ctx,look.slots.weapon,p,pose==="attack"&&(frame===1||frame===2));
    if(look.classId==="monk")weapon(ctx,look.slots.weapon,transformPoint(...hands.monk[0],look,pose,frame),false);
  }
  if(look.slots.ring){
    const p=transformPoint(...hands[look.classId][0],look,pose,frame);
    ctx.strokeStyle=look.slots.ring.trim;ctx.lineWidth=0.55;ctx.beginPath();ctx.ellipse(p[0]+0.5,p[1],0.6,0.9,-0.3,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle=look.slots.ring.light;ctx.fillRect(p[0]+0.4,p[1]-1,0.6+(seed(look.slots.ring)%3)*0.15,0.6);
  }
  ctx.restore();
}
export function paintedAtlas(asset:ArtAsset,look:HeroAppearance):HTMLCanvasElement {
  const c=canvas(asset.atlasWidth*R,asset.atlasHeight*R),ctx=context(c);ctx.scale(R,R);
  const pose=(asset.id.split("/")[2]??"idle") as Pose|"flash";
  asset.frames.forEach((f,i)=>{
    ctx.save();ctx.beginPath();ctx.rect(f.x,f.y,asset.width,asset.height);ctx.clip();ctx.translate(f.x+asset.anchor.x,f.y+asset.anchor.y);
    draw(ctx,look,pose,i);ctx.restore();
  });
  if(pose==="flash"){ctx.globalCompositeOperation="source-in";ctx.fillStyle="#fff5dc";ctx.fillRect(0,0,asset.atlasWidth,asset.atlasHeight);}
  return c;
}
export function paintedIcon(s:GearSkin):HTMLCanvasElement {
  const c=canvas(128,128),ctx=context(c);ctx.scale(R,R);
  if(s.slot==="chest"||s.slot==="gloves"||s.slot==="boots") {
    const layer=clothing(s.classId,s.slot,s);
    const box=s.slot==="chest"?[36,58,116,148]:s.slot==="boots"?[36,195,120,48]:[32,96,122,58];
    const fit=Math.min(28/box[2]!,28/box[3]!);
    ctx.drawImage(layer,box[0]!,box[1]!,box[2]!,box[3]!,16-box[2]!*fit/2,16-box[3]!*fit/2,box[2]!*fit,box[3]!*fit);
  } else if(s.slot==="head") {ctx.translate(16,16-heads[s.classId]);ctx.scale(2,2);ctx.translate(0,-heads[s.classId]/2);headpiece(ctx,s);}
  else if(s.slot==="weapon") {ctx.translate(16,17);ctx.scale(0.7,0.7);weapon(ctx,s,[0,s.classId==="warrior"?7:0],false);}
  else {ctx.strokeStyle=s.trim;ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(16,18,8,9,-0.2,0,Math.PI*2);ctx.stroke();ctx.fillStyle=s.light;ctx.fillRect(13,6,6,5);}
  material(c,s);return c;
}
