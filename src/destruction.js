// Разрушаемость: листы обшивки из кусков, брус (стойки, лаги), стекло,
// ломкий реквизит. Пули, взрывы и огонь работают через одно API.
import { THREE, scene, Q, clamp, lerp, rnd, sr, srnd } from './engine.js';
import { M } from './materials.js';
import { bucket, tintGeo } from './builder.js';
import { PH, GRP, SURF_NAME, addStaticCompound, addStaticCollider, removeBody, registerOwner,
         addDynamic, blastImpulse, pokeCloth, impulse, rayFirst } from './physics.js';
import { FXS, SND } from './fx.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';

export const DEST = { sheets:[], beams:[], glass:[], props:[], broken:0, dirty:new Set() };
/** Бюджет обломков-тел на кадр: взрыв рвёт сотни кусков, телами летят не все —
    остальное уходит в щепу и пыль, иначе физика съест кадр. */
let BUDGET = 60;
export function resetDebrisBudget(){ BUDGET = Q.debris >= 400 ? 70 : (Q.debris >= 250 ? 45 : 28); }
/** Внешние обработчики (огонь, игрок) — чтобы не плодить циклические импорты. */
export const HOOKS = { ignite:null, playerBlast:null, charBlast:null, onBreak:null };

const V = (x=0,y=0,z=0)=> new THREE.Vector3(x,y,z);
const _a = V(), _b = V(), _c = V();

/* ---------------------------------------------------------------------------
   ПРОСТРАНСТВЕННЫЙ ИНДЕКС горючего/разрушаемого: ячейка 1 м
--------------------------------------------------------------------------- */
const HASH = new Map(), HC = 1.0;
const hk = (ix,iy,iz)=> (ix+512)*1048576 + (iy+64)*2048 + (iz+512);
function hashAdd(p, ref){
  const k = hk(Math.floor(p.x/HC), Math.floor(p.y/HC), Math.floor(p.z/HC));
  let a = HASH.get(k); if(!a){ a=[]; HASH.set(k,a); } a.push(ref);
}
/** Элементы в радиусе: [{ref, pos, d}] */
export function query(p, r, filter){
  const out = [];
  const x0=Math.floor((p.x-r)/HC), x1=Math.floor((p.x+r)/HC), y0=Math.floor((p.y-r)/HC), y1=Math.floor((p.y+r)/HC),
        z0=Math.floor((p.z-r)/HC), z1=Math.floor((p.z+r)/HC);
  const seen = new Set();
  for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) for(let z=z0;z<=z1;z++){
    const a = HASH.get(hk(x,y,z)); if(!a) continue;
    for(const ref of a){
      if(!refAlive(ref)) continue;
      if(ref.t !== 'c'){ const key = ref.t==='b'?ref.b:ref.t==='p'?ref.p:ref.g; if(seen.has(key)) continue; seen.add(key); }
      const pos = refPos(ref, p), d = pos.distanceTo(p);
      if(d <= r && (!filter || filter(ref))) out.push({ref, pos, d});
    }
  }
  return out;
}
function refAlive(ref){
  if(ref.t==='c') return ref.s.alive[ref.k] === 1;
  if(ref.t==='b') return !ref.b.dead;
  if(ref.t==='p') return !ref.p.dead;
  if(ref.t==='g') return !ref.g.dead;
  return false;
}
const _rp = V();
/** Позиция элемента; для бруса — ближайшая к p точка на оси. */
export function refPos(ref, p){
  if(ref.t==='c') return ref.s.chunkCenter[ref.k];
  if(ref.t==='b'){
    const b = ref.b; if(!p) return b.center;
    const t = clamp(_rp.subVectors(p, b.a).dot(b.axis), 0, b.L);
    return V().copy(b.a).addScaledVector(b.axis, t);
  }
  if(ref.t==='p') return ref.p.center;
  if(ref.t==='g') return ref.g.center;
}
export function refFlammable(ref){ return ref.t==='c' || (ref.t==='b' && ref.b.wood) || (ref.t==='p' && ref.p.wood); }
export function refNormal(ref, from){
  if(ref.t==='c'){ const s = ref.s; return (from && V().subVectors(from, s.c).dot(s.N) < 0) ? s.N.clone().negate() : s.N.clone(); }
  return V(0,1,0);
}

/* ============================================================================
   ЛИСТ ОБШИВКИ
   Лист режется на сетку кусков с дрожащими внутренними узлами: пробоина
   получается рваной, а не квадратной. Каждый кусок — 8 вершин (лицо и тыл) в общем
   запечённом буфере; выбить кусок = схлопнуть его вершины.
============================================================================ */
const quadIdx = (idx, a,b,c,d)=>{ idx.push(a,b,c, a,c,d); };
const CV = 8;          // вершин на кусок
export function createSheet(o){
  const U = o.U.clone().normalize(), Vv = o.V.clone().normalize();
  const N = new THREE.Vector3().crossVectors(U, Vv).normalize();
  const nu = o.nu, nv = o.nv, w = o.w, h = o.h, t = o.t;
  const cw = w/nu, ch = h/nv;
  const G = [];
  const jit = o.jitter ?? 0.3;
  for(let j=0;j<=nv;j++) for(let i=0;i<=nu;i++){
    let u = -w/2 + i*cw, v = -h/2 + j*ch;
    if(i>0 && i<nu) u += sr(-jit,jit)*cw;
    if(j>0 && j<nv) v += sr(-jit,jit)*ch;
    G.push([u,v]);
  }
  const gp = (i,j)=> G[j*(nu+1)+i];
  const n = nu*nv, pos = new Float32Array(n*CV*3), nrm = new Float32Array(n*CV*3), uv = new Float32Array(n*CV*2);
  const idx = [];
  const W = (u,v,s)=> [o.c.x + U.x*u + Vv.x*v + N.x*s, o.c.y + U.y*u + Vv.y*v + N.y*s, o.c.z + U.z*u + Vv.z*v + N.z*s];
  const d = o.uvd ?? 0.82, ou = srnd()*3, ov = srnd()*3;
  const chunkCenter = [];
  let vi = 0;
  const put = (p, nn, uu, vv)=>{ pos.set(p, vi*3); nrm.set(nn, vi*3); uv[vi*2]=uu; uv[vi*2+1]=vv; vi++; };
  for(let j=0;j<nv;j++) for(let i=0;i<nu;i++){
    const q = [gp(i,j), gp(i+1,j), gp(i+1,j+1), gp(i,j+1)];
    const base = vi;
    for(const [u,v] of q) put(W(u,v, t/2), [N.x,N.y,N.z], (u+ou)*d, (v+ov)*d);
    quadIdx(idx, base, base+1, base+2, base+3);
    const b2 = vi;
    for(let k=3;k>=0;k--){ const [u,v]=q[k]; put(W(u,v,-t/2), [-N.x,-N.y,-N.z], (-u+ou)*d, (v+ov)*d); }
    quadIdx(idx, b2, b2+1, b2+2, b2+3);
    // торцы кусков не строятся: между целыми кусками их не видно, а у
    // пробоины их дорисовывает пул кромок (edgeAdd)
    let cu = 0, cv = 0; for(const [u,v] of q){ cu += u/4; cv += v/4; }
    chunkCenter.push(new THREE.Vector3(...W(cu, cv, t/2)));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm,3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv,2));
  g.setIndex(idx);
  fixWinding(g);
  const tint = o.tint || [1,1,1];
  tintGeo(g, tint[0], tint[1], tint[2]);
  const s = { id: DEST.sheets.length, c:o.c.clone(), U, V:Vv, N, w, h, t, nu, nv, cw, ch, G,
    alive: new Uint8Array(n).fill(1), hp: new Float32Array(n).fill(o.hp ?? 100), char: new Float32Array(n),
    chunkCenter, mat:o.mat, tint, colDepth:o.colDepth ?? 0.08, kind:o.kind || 'wall', body:null, mesh:null, base:0,
    deadN:0, surf:'wood' };
  g.userData.group = 'dest';
  g.userData.onBaked = (mesh, start)=>{ s.mesh = mesh; s.base = start; };
  bucket(o.mat).push(g);
  DEST.sheets.push(s);
  for(let k=0;k<n;k++) hashAdd(chunkCenter[k], {t:'c', s, k});
  return s;
}
function fixWinding(g){
  const p = g.attributes.position, nn = g.attributes.normal, ix = g.index.array;
  const vn = V();
  for(let i=0;i<ix.length;i+=3){
    _a.fromBufferAttribute(p, ix[i]); _b.fromBufferAttribute(p, ix[i+1]); _c.fromBufferAttribute(p, ix[i+2]);
    _b.sub(_a); _c.sub(_a); _a.crossVectors(_b,_c);
    vn.fromBufferAttribute(nn, ix[i]);
    if(_a.dot(vn) < 0){ const t = ix[i+1]; ix[i+1] = ix[i+2]; ix[i+2] = t; }
  }
}
/* ---------------------------------------------------------------------------
   ПУЛ КРОМОК: торцы кусков вокруг пробоин. Один меш на материал, слоты
   переиспользуются; кромка исчезает, когда выбит и её кусок.
--------------------------------------------------------------------------- */
const EDGE_POOLS = {};
const EDGE_OF = new Map();      // ключ куска → [{pool, slot}]
function edgePool(mat){
  if(EDGE_POOLS[mat]) return EDGE_POOLS[mat];
  const MAXQ = Q.debris >= 400 ? 9000 : 5000, NV = MAXQ*4;
  const g = new THREE.BufferGeometry();
  const mk = (n)=> new THREE.BufferAttribute(new Float32Array(NV*n), n).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', mk(3)); g.setAttribute('normal', mk(3)); g.setAttribute('uv', mk(2));
  g.setAttribute('color', mk(3)); g.setAttribute('aBurn', mk(2));
  const idx = new Uint32Array(MAXQ*6);
  for(let i=0;i<MAXQ;i++){ idx.set([i*4, i*4+1, i*4+2, i*4, i*4+2, i*4+3], i*6); }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const m = new THREE.Mesh(g, M[mat]); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
  m.userData.nomerge = true; scene.add(m);
  return EDGE_POOLS[mat] = { mesh:m, g, free:[], next:0, MAXQ };
}
function neighbor(s, k, e){
  const i = k % s.nu, j = (k/s.nu)|0;
  const [di,dj] = [[0,-1],[1,0],[0,1],[-1,0]][e];
  const ii = i+di, jj = j+dj;
  return (ii<0||jj<0||ii>=s.nu||jj>=s.nv) ? -1 : jj*s.nu+ii;
}
const _en = V(), _ea = V(), _eb = V();
function edgeAdd(s, k, e){
  const P = edgePool(s.mat);
  let slot = P.free.length ? P.free.pop() : (P.next < P.MAXQ ? P.next++ : -1);
  if(slot < 0) return;
  const q = chunkPoly(s, k), [u0,v0] = q[e], [u1,v1] = q[(e+1)%4];
  const W = (u,v,n)=> V(s.c.x + s.U.x*u + s.V.x*v + s.N.x*n, s.c.y + s.U.y*u + s.V.y*v + s.N.y*n, s.c.z + s.U.z*u + s.V.z*v + s.N.z*n);
  let pts = [W(u0,v0,s.t/2), W(u0,v0,-s.t/2), W(u1,v1,-s.t/2), W(u1,v1,s.t/2)];
  _ea.subVectors(pts[1], pts[0]); _eb.subVectors(pts[3], pts[0]);
  const ex = V().subVectors(W(u1,v1,0), W(u0,v0,0)).normalize();
  _en.crossVectors(ex, s.N).normalize();                          // наружу из куска k
  if(V().crossVectors(_ea, V().subVectors(pts[2], pts[0])).dot(_en) < 0) pts = [pts[0], pts[3], pts[2], pts[1]];
  const g = P.g, b = slot*4, el = Math.hypot(u1-u0, v1-v0)*0.82;
  const ch = s.char[k];
  for(let i=0;i<4;i++){
    g.attributes.position.setXYZ(b+i, pts[i].x, pts[i].y, pts[i].z);
    g.attributes.normal.setXYZ(b+i, _en.x, _en.y, _en.z);
    g.attributes.color.setXYZ(b+i, s.tint[0]*0.92, s.tint[1]*0.88, s.tint[2]*0.8);
    g.attributes.aBurn.setXY(b+i, ch, 0);
  }
  g.attributes.uv.setXY(b, 0, 0); g.attributes.uv.setXY(b+1, 0, 0.01); g.attributes.uv.setXY(b+2, el, 0.01); g.attributes.uv.setXY(b+3, el, 0);
  for(const a of ['position','normal','color','aBurn','uv']){ const at = g.attributes[a]; at.addUpdateRange(b*at.itemSize, 4*at.itemSize); at.needsUpdate = true; }
  const key = s.id*4096 + k;
  let arr = EDGE_OF.get(key); if(!arr){ arr = []; EDGE_OF.set(key, arr); }
  arr.push({P, slot});
}
function edgeRemoveChunk(s, k){
  const key = s.id*4096 + k, arr = EDGE_OF.get(key); if(!arr) return;
  for(const {P, slot} of arr){
    const pa = P.g.attributes.position, b = slot*4;
    for(let i=0;i<4;i++) pa.setXYZ(b+i, 0, -50, 0);
    pa.addUpdateRange(b*3, 12); pa.needsUpdate = true;
    P.free.push(slot);
  }
  EDGE_OF.delete(key);
}
const _sm = new THREE.Matrix4();
function sheetQuat(s){ _sm.makeBasis(s.U, s.V, s.N); return new THREE.Quaternion().setFromRotationMatrix(_sm); }
/** Коллайдер листа: оставшиеся куски, сгруппированные в вертикальные полосы. */
function rebuildSheetBody(s){
  if(s.body){ removeBody(s.body); s.body = null; }
  const parts = [];
  const nOff = s.t/2 - s.colDepth/2;
  const add = (u0,u1,v0,v1)=>{
    const u=(u0+u1)/2, v=(v0+v1)/2;
    parts.push({cx:s.c.x + s.U.x*u + s.V.x*v + s.N.x*nOff, cy:s.c.y + s.U.y*u + s.V.y*v + s.N.y*nOff,
                cz:s.c.z + s.U.z*u + s.V.z*v + s.N.z*nOff, hx:(u1-u0)/2, hy:(v1-v0)/2, hz:s.colDepth/2});
  };
  if(s.deadN === 0) add(-s.w/2, s.w/2, -s.h/2, s.h/2);
  else for(let i=0;i<s.nu;i++){
    let j=0;
    while(j < s.nv){
      if(!s.alive[j*s.nu+i]){ j++; continue; }
      const j0 = j; while(j < s.nv && s.alive[j*s.nu+i]) j++;
      add(-s.w/2 + i*s.cw, -s.w/2 + (i+1)*s.cw, -s.h/2 + j0*s.ch, -s.h/2 + j*s.ch);
    }
  }
  if(!parts.length) return;
  s.body = addStaticCompound(parts, sheetQuat(s), s.owner, s.c);
}
function chunkAt(s, p){
  _a.subVectors(p, s.c);
  const u = _a.dot(s.U), v = _a.dot(s.V);
  const i = clamp(Math.floor((u + s.w/2)/s.cw), 0, s.nu-1), j = clamp(Math.floor((v + s.h/2)/s.ch), 0, s.nv-1);
  return j*s.nu + i;
}
function collapseRange(mesh, start, count, center){
  const pa = mesh.geometry.attributes.position;
  for(let i=start;i<start+count;i++) pa.setXYZ(i, center.x, center.y, center.z);
  pa.addUpdateRange(start*3, count*3); pa.needsUpdate = true;
}
/** Выбить кусок листа. mode: 'bullet'|'blast'|'fire'|'fall'. */
function breakChunk(s, k, dir, power, mode){
  if(!s.alive[k]) return;
  s.alive[k] = 0; s.deadN++; DEST.broken++;
  const cc = s.chunkCenter[k];
  if(s.mesh) collapseRange(s.mesh, s.base + k*CV, CV, cc);
  edgeRemoveChunk(s, k);
  for(let e=0;e<4;e++){ const nb = neighbor(s, k, e); if(nb >= 0 && s.alive[nb]) edgeAdd(s, nb, (e+2)%4); }
  FXS.decals.removeKey(s.id*4096 + k);
  DEST.dirty.add(s);
  spawnChunkDebris(s, k, dir, power, mode);
  if(HOOKS.onBreak) HOOKS.onBreak('chunk', cc, mode);
}
/** Куски, потерявшие связь с краем листа (гвозди по периметру), падают. */
function dropIslands(s, dir){
  const nu=s.nu, nv=s.nv, seen = new Uint8Array(nu*nv), stack=[];
  for(let j=0;j<nv;j++) for(let i=0;i<nu;i++){
    const k=j*nu+i;
    if((i===0||j===0||i===nu-1||j===nv-1) && s.alive[k]){ seen[k]=1; stack.push(k); }
  }
  while(stack.length){
    const k = stack.pop(), i = k%nu, j = (k/nu)|0;
    for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const ii=i+di, jj=j+dj; if(ii<0||jj<0||ii>=nu||jj>=nv) continue;
      const q = jj*nu+ii; if(!seen[q] && s.alive[q]){ seen[q]=1; stack.push(q); }
    }
  }
  for(let k=0;k<nu*nv;k++) if(s.alive[k] && !seen[k]) breakChunk(s, k, dir, 0.3, 'fall');
  // от листа осталась пара кусков — они уже ничего не держат
  if(s.deadN > nu*nv*0.8) for(let k=0;k<nu*nv;k++) if(s.alive[k]) breakChunk(s, k, dir, 0.2, 'fall');
}
function chunkPoly(s, k){
  const i = k % s.nu, j = (k/s.nu)|0, G = s.G, nu1 = s.nu+1;
  return [G[j*nu1+i], G[j*nu1+i+1], G[(j+1)*nu1+i+1], G[(j+1)*nu1+i]].map(p=>[p[0],p[1]]);
}
function splitPoly(poly){
  // случайный разрез через центр: кусок ломается на два неровных обломка
  let cx=0, cy=0; for(const p of poly){ cx+=p[0]/poly.length; cy+=p[1]/poly.length; }
  const a = Math.random()*Math.PI, nx = Math.cos(a), ny = Math.sin(a);
  const A=[], B=[];
  for(let i=0;i<poly.length;i++){
    const p = poly[i], q = poly[(i+1)%poly.length];
    const dp = (p[0]-cx)*nx + (p[1]-cy)*ny, dq = (q[0]-cx)*nx + (q[1]-cy)*ny;
    (dp >= 0 ? A : B).push(p);
    if((dp >= 0) !== (dq >= 0)){ const t = dp/(dp-dq); const m = [p[0]+(q[0]-p[0])*t, p[1]+(q[1]-p[1])*t]; A.push(m); B.push(m); }
  }
  return [A,B].filter(P=>P.length>=3);
}
function spawnChunkDebris(s, k, dir, power, mode){
  const poly = chunkPoly(s, k);
  const split = BUDGET > 20 && (mode==='blast' ? Math.random()<0.7 : mode==='bullet' ? Math.random()<0.5 : false);
  const pieces = BUDGET <= 0 ? [] : (split ? splitPoly(poly) : [poly]);
  BUDGET -= pieces.length;
  const charred = s.char[k];
  const q = sheetQuat(s);
  for(const P of pieces){
    let cu=0, cv=0; for(const p of P){ cu+=p[0]/P.length; cv+=p[1]/P.length; }
    const shape = new THREE.Shape(P.map(p=> new THREE.Vector2(p[0]-cu, p[1]-cv)));
    const g = new THREE.ExtrudeGeometry(shape, {depth:s.t, bevelEnabled:false});
    g.translate(0,0,-s.t/2);
    const uv = g.attributes.uv, pa = g.attributes.position;
    for(let i=0;i<uv.count;i++) uv.setXY(i, (pa.getX(i)+cu)*0.82, (pa.getY(i)+cv)*0.82);
    tintGeo(g, s.tint[0], s.tint[1], s.tint[2]);
    const nb = new Float32Array(pa.count*2);
    for(let i=0;i<pa.count;i++){ nb[i*2]=charred; nb[i*2+1]= mode==='fire'?1:0; }
    g.setAttribute('aBurn', new THREE.BufferAttribute(nb,2));
    const mesh = new THREE.Mesh(g, M[s.mat] || M.osb);
    mesh.userData.ownGeo = true;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.quaternion.copy(q);
    mesh.position.set(s.c.x + s.U.x*cu + s.V.x*cv, s.c.y + s.U.y*cu + s.V.y*cv, s.c.z + s.U.z*cu + s.V.z*cv);
    scene.add(mesh);
    let mu=1e9, Mu=-1e9, mv=1e9, Mv=-1e9;
    for(const p of P){ mu=Math.min(mu,p[0]); Mu=Math.max(Mu,p[0]); mv=Math.min(mv,p[1]); Mv=Math.max(Mv,p[1]); }
    const sp = power*(mode==='blast'? 9 : mode==='bullet'? 1.6 : 0.4);
    const vel = dir.clone().multiplyScalar(sp).add(V(rnd(-0.6,0.6), rnd(0,1)*(mode==='blast'?2:0.5), rnd(-0.6,0.6)));
    addDynamic(mesh, { size:[Math.max(0.02,Mu-mu), Math.max(0.02,Mv-mv), s.t*1.6],
      mass: Math.max(0.15,(Mu-mu)*(Mv-mv)*s.t*620), vel,
      spin: V(rnd(-8,8), rnd(-8,8), rnd(-8,8)).multiplyScalar(mode==='blast'?1:0.4), friction:0.8, restitution:0.12,
      life: sr(25,40), surf:'wood', group: GRP.DEBRIS });
  }
  const cc = s.chunkCenter[k];
  const nChips = (mode==='blast' ? 6 : mode==='bullet' ? 4 : 2) + (pieces.length ? 0 : 4);
  const fl = floorBelow(cc);
  for(let i=0;i<nChips;i++){
    const v = dir.clone().multiplyScalar(rnd(1,4)*(mode==='blast'?2:1)).add(V(rnd(-1.5,1.5), rnd(0,2.5), rnd(-1.5,1.5)));
    FXS.splinters.spawn(cc, v, V(rnd(0.08,0.22), rnd(0.006,0.012), rnd(0.012,0.03)), fl, rnd(6,12));
  }
  FXS.dust.spawn({p:cc, v:dir.clone().multiplyScalar(0.6).add(V(0,0.2,0)), life:rnd(1.5,3), s0:0.25, s1:1.1,
    col:mode==='fire'?[0.18,0.16,0.15]:[0.72,0.62,0.48], a0:0.35, a1:0, drag:1.5, g:0.05});
}
/** Высота пола под точкой (для щепы без физики): луч вниз по статике. */
export function floorBelow(p){
  const h = rayFirst(_b.set(p.x, p.y+0.05, p.z), _c.set(p.x, p.y-30, p.z), GRP.STATIC);
  return h ? h.p.y : 0;
}

/* ============================================================================
   БРУС: стойки каркаса, лаги перекрытия, стойки перил и укрытий.
   Ломается в точке удара на две половины с рваным торцом — дальше их
   ведёт физика: верх заваливается, низ остаётся торчать или падает.
============================================================================ */
export function createBeam(o){
  const a = o.a.clone(), b = o.b.clone();
  const axis = V().subVectors(b,a); const L = axis.length(); axis.normalize();
  const up = Math.abs(axis.y) > 0.9 ? V(1,0,0) : V(0,1,0);
  const side = o.side ? o.side.clone().normalize() : V().crossVectors(up, axis).normalize();
  const other = V().crossVectors(axis, side).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, other, axis));
  const center = V().addVectors(a,b).multiplyScalar(0.5);
  const g = new THREE.BoxGeometry(o.sx, o.sy, L);
  const uv = g.attributes.uv; const dd = o.uvd ?? 0.9;
  const s = [[L,o.sy],[L,o.sy],[o.sx,L],[o.sx,L],[o.sx,o.sy],[o.sx,o.sy]];
  const ro = srnd()*2;
  for(let f=0;f<6;f++) for(let i=0;i<4;i++){ const k=f*4+i; let u=uv.getX(k)*s[f][0]*dd, v=uv.getY(k)*s[f][1]*dd;
    if(s[f][1] > s[f][0]){ const t=u; u=v; v=t; } uv.setXY(k, u+ro, v); }
  g.applyMatrix4(new THREE.Matrix4().compose(center, q, V(1,1,1)));
  if(o.tint) tintGeo(g, ...o.tint);
  const bm = { id: DEST.beams.length, a, b, L, axis, side, q, center, sx:o.sx, sy:o.sy, mat:o.mat||'wood',
    hp:o.hp ?? 260, wood: o.wood !== false, char:0, dead:false, mesh:null, base:0, count:24,
    collide: o.collide !== false, noPlayer: !!o.noPlayer, tint:o.tint || [1,1,1], surf: o.surf || (o.wood===false?'metal':'wood'),
    fragile: o.fragile ?? 1 };
  g.userData.group = 'dest';
  g.userData.onBaked = (mesh, start)=>{ bm.mesh = mesh; bm.base = start; };
  bucket(bm.mat).push(g);
  DEST.beams.push(bm);
  const nPts = Math.max(1, Math.round(L/0.8));
  for(let i=0;i<nPts;i++) hashAdd(V().lerpVectors(a,b,(i+0.5)/nPts), {t:'b', b:bm});
  return bm;
}
function beamBody(bm){
  const c = {cx:bm.center.x, cy:bm.center.y, cz:bm.center.z, hx:bm.sx/2, hy:bm.sy/2, hz:bm.L/2,
             q:[bm.q.x,bm.q.y,bm.q.z,bm.q.w], surf:bm.surf, noPlayer: bm.noPlayer};
  bm.body = addStaticCollider(c, bm.owner);
}
function breakBeam(bm, hitP, dir, power, mode){
  if(bm.dead) return;
  bm.dead = true; DEST.broken++;
  if(bm.mesh) collapseRange(bm.mesh, bm.base, bm.count, bm.center);
  if(bm.body){ removeBody(bm.body); bm.body = null; }
  FXS.decals.removeKey(100000 + bm.id);
  const t = hitP ? clamp(V().subVectors(hitP, bm.a).dot(bm.axis), 0.12, bm.L-0.12) : bm.L*sr(0.3,0.7);
  for(const [t0,t1] of [[0, t], [t, bm.L]]){
    const len = t1 - t0; if(len < 0.1) continue;
    const g = new THREE.BoxGeometry(bm.sx, bm.sy, len, 1, 1, 2);
    // рваный торец: вершины на стороне излома сдвигаются вдоль оси вразнобой
    const pa = g.attributes.position, brokenEnd = (t0 === 0) ? len/2 : -len/2;
    for(let i=0;i<pa.count;i++)
      if(Math.abs(pa.getZ(i) - brokenEnd) < 1e-4) pa.setZ(i, pa.getZ(i) + (brokenEnd>0?1:-1)*rnd(-0.07,0.05));
    g.computeVertexNormals();
    tintGeo(g, ...bm.tint);
    const nb = new Float32Array(pa.count*2); for(let i=0;i<pa.count;i++){ nb[i*2]=bm.char; nb[i*2+1]= mode==='fire'?0.8:0; }
    g.setAttribute('aBurn', new THREE.BufferAttribute(nb,2));
    const mesh = new THREE.Mesh(g, M[bm.mat] || M.wood);
    mesh.userData.ownGeo = true; mesh.castShadow = mesh.receiveShadow = true;
    mesh.quaternion.copy(bm.q);
    mesh.position.copy(bm.a).addScaledVector(bm.axis, (t0+t1)/2);
    scene.add(mesh);
    const k = mode==='blast' ? power*6 : 0.6*power;
    const vel = dir.clone().multiplyScalar(k).add(V(rnd(-0.3,0.3), mode==='blast'?rnd(0.5,2):0, rnd(-0.3,0.3)));
    addDynamic(mesh, {size:[bm.sx, bm.sy, len], mass: bm.sx*bm.sy*len*520, vel,
      spin: V(rnd(-2,2),rnd(-2,2),rnd(-2,2)).multiplyScalar(mode==='blast'?2:0.5),
      life: sr(40,70), group: GRP.DYN, friction:0.8, restitution:0.08, surf:bm.surf});
  }
  const hp = hitP || bm.center;
  const fl = floorBelow(hp);
  for(let i=0;i<8;i++) FXS.splinters.spawn(hp, dir.clone().multiplyScalar(rnd(1,3)).add(V(rnd(-1.5,1.5),rnd(0,2),rnd(-1.5,1.5))),
    V(rnd(0.08,0.3), rnd(0.008,0.02), rnd(0.012,0.03)), fl, rnd(8,14));
  if(bm.wood) SND.wood(hp, 1.2); else SND.hit(hp, 'metal');
  if(HOOKS.onBreak) HOOKS.onBreak('beam', hp, mode);
}

/* ============================================================================
   СТЕКЛО: первая пуля — звезда трещин, вторая (или взрыв) — осыпается.
   Осколки строятся радиально от точки удара и обрезаются рамой; часть
   остаётся торчать в раме, крупные падают телами, мелочь — крошкой.
============================================================================ */
export function registerGlass(mesh, o={}){
  mesh.updateWorldMatrix(true,false);
  const gl = { id: DEST.glass.length, mesh, w: mesh.userData.glass.w, h: mesh.userData.glass.h, hp: o.hp ?? 2, dead:false,
    center: V().setFromMatrixPosition(mesh.matrixWorld), q: new THREE.Quaternion().setFromRotationMatrix(mesh.matrixWorld),
    playerCollide: !!o.playerCollide };
  gl.N = V(0,0,1).applyQuaternion(gl.q); gl.U = V(1,0,0).applyQuaternion(gl.q); gl.Vv = V(0,1,0).applyQuaternion(gl.q);
  DEST.glass.push(gl);
  hashAdd(gl.center, {t:'g', g:gl});
  return gl;
}
function glassBody(gl){
  const c = {cx:gl.center.x, cy:gl.center.y, cz:gl.center.z, hx:gl.w/2, hy:gl.h/2, hz:0.012,
             q:[gl.q.x,gl.q.y,gl.q.z,gl.q.w], surf:'glass', noPlayer: !gl.playerCollide};
  gl.body = addStaticCollider(c, gl.owner);
}
function clipRect(poly, hw, hh){
  const clip = (P, f)=>{ const out=[]; for(let i=0;i<P.length;i++){ const a=P[i], b=P[(i+1)%P.length], fa=f(a), fb=f(b);
      if(fa>=0) out.push(a); if((fa>=0)!==(fb>=0)){ const t=fa/(fa-fb); out.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]); } } return out; };
  let P = poly;
  for(const f of [p=>p[0]+hw, p=>hw-p[0], p=>p[1]+hh, p=>hh-p[1]]){ P = clip(P, f); if(P.length<3) return null; }
  return P;
}
function shatterGlass(gl, hitP, dir, power){
  if(gl.dead) return;
  gl.dead = true; DEST.broken++;
  if(gl.body){ removeBody(gl.body); gl.body = null; }
  gl.mesh.visible = false;
  FXS.decals.removeKey(200000 + gl.id);
  const hp = hitP || gl.center;
  _a.subVectors(hp, gl.center);
  const iu = clamp(_a.dot(gl.U), -gl.w/2, gl.w/2), iv = clamp(_a.dot(gl.Vv), -gl.h/2, gl.h/2);
  const spokes = 9 + Math.floor(Math.random()*5);
  const rings = [0.08, 0.22, 0.45, 0.8, 1.3].map(r=>r*Math.max(gl.w,gl.h));
  const ang = []; for(let i=0;i<spokes;i++) ang.push((i + rnd(-0.3,0.3))/spokes*Math.PI*2);
  const P = (a, r)=> [iu + Math.cos(a)*r, iv + Math.sin(a)*r];
  const stay = [], fall = [];
  for(let s=0;s<spokes;s++) for(let r=0;r<rings.length;r++){
    const a0 = ang[s], a1 = ang[(s+1)%spokes] + (s===spokes-1?Math.PI*2:0);
    const r0 = r===0 ? 0 : rings[r-1]*rnd(0.9,1.1), r1 = rings[r]*rnd(0.9,1.1);
    const poly = r===0 ? [[iu,iv], P(a0,r1), P(a1,r1)] : [P(a0,r0), P(a0,r1), P(a1,r1), P(a1,r0)];
    const cp = clipRect(poly, gl.w/2, gl.h/2); if(!cp) continue;
    const onEdge = cp.some(p=> Math.abs(Math.abs(p[0])-gl.w/2)<1e-3 || Math.abs(Math.abs(p[1])-gl.h/2)<1e-3);
    (onEdge && r >= 2 && Math.random() < 0.4 ? stay : fall).push(cp);
  }
  // осколки, оставшиеся в раме, — один статичный меш
  if(stay.length){
    const parts = stay.map(cp=> new THREE.ShapeGeometry(new THREE.Shape(cp.map(p=>new THREE.Vector2(p[0],p[1])))));
    const g = BGU.mergeGeometries(parts, false);
    if(g){ const m = new THREE.Mesh(g, gl.mesh.material); m.position.copy(gl.center); m.quaternion.copy(gl.q);
      m.userData.nomerge = true; scene.add(m); gl.remnant = m; }
  }
  let dynLeft = Q.debris >= 400 ? 14 : 7;
  const area = cp=>{ let s=0; for(let i=0;i<cp.length;i++){ const a=cp[i], b=cp[(i+1)%cp.length]; s+=a[0]*b[1]-b[0]*a[1]; } return Math.abs(s)/2; };
  for(const cp of fall){
    let cu=0, cv=0; for(const p of cp){ cu+=p[0]/cp.length; cv+=p[1]/cp.length; }
    const wp = V().copy(gl.center).addScaledVector(gl.U, cu).addScaledVector(gl.Vv, cv);
    const A = area(cp);
    const out = dir.clone().multiplyScalar(power*rnd(1,3)).add(V(rnd(-0.5,0.5), rnd(-0.2,0.6), rnd(-0.5,0.5)));
    if(A > 0.01 && dynLeft-- > 0){
      const shape = new THREE.Shape(cp.map(p=>new THREE.Vector2(p[0]-cu, p[1]-cv)));
      const g = new THREE.ExtrudeGeometry(shape, {depth:0.006, bevelEnabled:false});
      const m = new THREE.Mesh(g, gl.mesh.material); m.userData.ownGeo = true;
      m.position.copy(wp); m.quaternion.copy(gl.q); m.castShadow = true; scene.add(m);
      let mu=1e9,Mu=-1e9,mv=1e9,Mv=-1e9;
      for(const p of cp){ mu=Math.min(mu,p[0]);Mu=Math.max(Mu,p[0]);mv=Math.min(mv,p[1]);Mv=Math.max(Mv,p[1]); }
      addDynamic(m, {size:[Mu-mu, Mv-mv, 0.012], mass: A*0.006*2500, vel:out, spin:V(rnd(-6,6),rnd(-6,6),rnd(-6,6)),
        life: sr(12,20), friction:0.5, restitution:0.05, surf:'glass', group:GRP.DEBRIS});
    } else {
      const fl = floorBelow(wp);
      for(let i=0;i<2;i++) FXS.glassChips.spawn(wp, out.clone().add(V(rnd(-1,1),rnd(0,1),rnd(-1,1))),
        V(rnd(0.02,0.07),rnd(0.02,0.07),1), fl, rnd(8,15));
    }
  }
  SND.glass(hp, 14);
  if(HOOKS.onBreak) HOOKS.onBreak('glass', hp, 'blast');
}

/* ============================================================================
   РЕКВИЗИТ: ящики, поддоны, баррикады, взрывоопасные бочки.
   Пока цел — статичное укрытие; сломан — каждая деталь становится телом.
============================================================================ */
export function registerProp(group, o={}){
  group.userData.nomerge = true;
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(V()), size = box.getSize(V());
  const p = { group, hp:o.hp ?? 150, dead:false, wood:o.wood ?? true, surf:o.surf || 'wood', center,
    col: o.col || {cx:center.x, cy:center.y, cz:center.z, hx:size.x/2, hy:size.y/2, hz:size.z/2, q:null},
    onBreak:o.onBreak || null, explosive: !!o.explosive, mass:o.mass ?? 8, burnHp: o.burnHp ?? 1 };
  DEST.props.push(p);
  hashAdd(center, {t:'p', p});
  return p;
}
function propBody(p){ const c = Object.assign({surf:p.surf}, p.col); p.body = addStaticCollider(c, p.owner); }
export function breakProp(p, hitP, dir, power, mode){
  if(p.dead) return;
  p.dead = true; DEST.broken++;
  if(p.body){ removeBody(p.body); p.body = null; }
  const meshes = [];
  p.group.traverse(o=>{ if(o.isMesh) meshes.push(o); });
  const n = meshes.length;
  for(const m of meshes){
    m.updateWorldMatrix(true,false);
    const g = m.geometry; g.computeBoundingBox();
    const sz = g.boundingBox.getSize(V()), ctr = g.boundingBox.getCenter(V());
    const wp = ctr.clone().applyMatrix4(m.matrixWorld);
    const wq = new THREE.Quaternion(); m.getWorldQuaternion(wq);
    const ws = V(); m.getWorldScale(ws);
    const geo = g.clone(); geo.translate(-ctr.x,-ctr.y,-ctr.z);
    const nm = new THREE.Mesh(geo, m.material); nm.userData.ownGeo = true;
    nm.position.copy(wp); nm.quaternion.copy(wq); nm.scale.copy(ws); nm.castShadow = true; nm.receiveShadow = true;
    scene.add(nm);
    const away = V().subVectors(wp, hitP || p.center).normalize();
    const k = mode==='blast' ? power*7 : 1.2;
    addDynamic(nm, {size:[Math.max(0.02,sz.x*ws.x), Math.max(0.02,sz.y*ws.y), Math.max(0.02,sz.z*ws.z)],
      mass: Math.max(0.3, p.mass/n), vel: away.multiplyScalar(k).addScaledVector(dir, k*0.5).add(V(0, mode==='blast'?rnd(1,3):0.5, 0)),
      spin: V(rnd(-5,5),rnd(-5,5),rnd(-5,5)), life: sr(35,60), group: n > 12 ? GRP.DEBRIS : GRP.DYN, surf:p.surf});
  }
  p.group.removeFromParent();
  if(p.explosive && HOOKS.barrel) HOOKS.barrel(p);
  if(p.wood) SND.wood(p.center, 1.5);
  if(p.onBreak) p.onBreak(p, hitP, dir, power, mode);
  if(HOOKS.onBreak) HOOKS.onBreak('prop', p.center, mode);
}

/* ============================================================================
   ФИЗИКА РАЗРУШАЕМЫХ: тела создаются после инициализации Ammo
============================================================================ */
export function initDestructiblePhysics(){
  for(const s of DEST.sheets){ s.owner = registerOwner({type:'sheet', s}); rebuildSheetBody(s); }
  for(const b of DEST.beams){ b.owner = registerOwner({type:'beam', b}); if(b.collide) beamBody(b); }
  for(const g of DEST.glass){ g.owner = registerOwner({type:'glass', g}); glassBody(g); }
  for(const p of DEST.props){ p.owner = registerOwner({type:'prop', p}); propBody(p); }
}
/** Перестройка коллайдеров листов, изменившихся за кадр (один раз на лист). */
export function flushDestruction(){
  let guard = 0;
  while(DEST.dirty.size && guard++ < 4){
    const list = [...DEST.dirty]; DEST.dirty.clear();
    for(const s of list) dropIslands(s, V(0,-1,0));
    for(const s of list) rebuildSheetBody(s);
  }
}

/* ============================================================================
   ПОПАДАНИЕ ПУЛИ. Возвращает {stop, cost, surf}: дерево пробивается с
   потерей энергии, бетон и металл останавливают пулю.
============================================================================ */
export function bulletHit(hit, dir, power){
  const own = hit.idx >= 0 ? PH.owners[hit.idx] : null;
  const dmg = 34*power;
  if(!own){
    const surf = SURF_NAME[hit.idx] || 'conc';
    impactFX(hit.p, hit.n, surf, dir);
    return {stop: surf !== 'wood' && surf !== 'glass', cost: surf==='wood'?0.5:1, surf};
  }
  if(own.type === 'sheet'){
    const s = own.s;
    let dn = dir.dot(s.N);
    if(Math.abs(dn) < 0.05) dn = dn < 0 ? -0.05 : 0.05;
    // точка на лицевой плоскости листа (коллайдер уходит вглубь стены)
    _a.subVectors(hit.p, s.c); const off = _a.dot(s.N);
    const pf = hit.p.clone().addScaledVector(dir, (s.t/2 - off)/dn);
    const k = chunkAt(s, pf);
    if(!s.alive[k]) return {stop:false, cost:0, surf:'wood'};
    const out = dn < 0 ? s.N : s.N.clone().negate();     // сторона, куда летит щепа на входе
    FXS.decals.add(pf, s.N, rnd(0.07,0.1), Math.random()<0.5?0:1, s.id*4096+k);
    const fl = floorBelow(pf);
    for(let i=0;i<3;i++) FXS.splinters.spawn(pf, dir.clone().multiplyScalar(rnd(0.5,2.5)).addScaledVector(out, rnd(0.2,1)).add(V(rnd(-.6,.6),rnd(0,1),rnd(-.6,.6))),
      V(rnd(0.03,0.09), rnd(0.003,0.007), rnd(0.006,0.014)), fl, rnd(5,10));
    FXS.dust.spawn({p:pf, v:out.clone().multiplyScalar(0.8), life:rnd(0.8,1.6), s0:0.08, s1:0.45, col:[0.75,0.64,0.5], a0:0.4, a1:0, drag:2});
    SND.hit(pf, 'wood');
    damageChunk(s, k, dmg, dir, power, 'bullet');
    // соседи получают долю: очередь «прорезает» щель
    const i = k % s.nu, j = (k/s.nu)|0;
    for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){ const ii=i+di, jj=j+dj;
      if(ii>=0&&jj>=0&&ii<s.nu&&jj<s.nv) damageChunk(s, jj*s.nu+ii, dmg*0.18, dir, power*0.5, 'bullet'); }
    return {stop:false, cost:0.12, surf:'wood'};
  }
  if(own.type === 'beam'){
    const b = own.b;
    FXS.decals.add(hit.p, hit.n, rnd(0.06,0.08), b.wood?0:2, 100000+b.id);
    impactFX(hit.p, hit.n, b.surf, dir);
    if(b.wood){ b.hp -= dmg*b.fragile; if(b.hp <= 0) breakBeam(b, hit.p, dir, power, 'bullet'); }
    return {stop: !b.wood, cost: b.wood ? Math.min(0.9, (b.sx+b.sy)*2.2) : 1, surf: b.surf};
  }
  if(own.type === 'glass'){
    const g = own.g;
    g.hp -= 1;
    if(g.hp <= 0) shatterGlass(g, hit.p, dir, power);
    else { FXS.decals.add(hit.p, hit.n.dot(dir) < 0 ? hit.n : hit.n.clone().negate(), rnd(0.35,0.55), 3, 200000+g.id); SND.glass(hit.p, 3); }
    return {stop:false, cost:0.05, surf:'glass'};
  }
  if(own.type === 'prop'){
    const p = own.p;
    impactFX(hit.p, hit.n, p.surf, dir);
    p.hp -= dmg;
    if(p.explosive && p.hp < 60 && !p.leaking){ p.leaking = true; if(HOOKS.leak) HOOKS.leak(p, hit.p); }
    if(p.hp <= 0) breakProp(p, hit.p, dir, power, 'bullet');
    return {stop: !p.wood, cost:0.5, surf:p.surf};
  }
  if(own.type === 'dyn'){
    const r = own.rec;
    impulse(r.body, dir.x*2.5*power, dir.y*2.5*power, dir.z*2.5*power, 0,0,0);
    impactFX(hit.p, hit.n, r.surf, dir);
    if(r.onHit) r.onHit(r, hit, dir, power);
    return {stop: r.surf !== 'wood', cost:0.35, surf:r.surf};
  }
  return {stop:true, cost:1, surf:'conc'};
}
function damageChunk(s, k, dmg, dir, power, mode){
  if(!s.alive[k]) return;
  s.hp[k] -= dmg;
  if(s.hp[k] <= 0) breakChunk(s, k, dir, power, mode);
}
/** Искры, пыль, крошка — по типу поверхности. */
export function impactFX(p, n, surf, dir){
  if(surf === 'metal'){
    for(let i=0;i<7;i++){ const v = n.clone().multiplyScalar(rnd(2,6)).add(V(rnd(-2,2),rnd(-1,3),rnd(-2,2))).addScaledVector(dir,-1.5);
      FXS.spark.spawn({p, v, life:rnd(0.15,0.45), s0:0.035, s1:0.01, col:[1,0.75,0.4], a0:1, a1:0, g:-9.8, drag:0.8}); }
    FXS.decals.add(p, n, 0.05, 2, null);
    SND.hit(p, 'metal');
  } else if(surf === 'conc'){
    const fl = floorBelow(p);
    for(let i=0;i<4;i++) FXS.concChips.spawn(p, n.clone().multiplyScalar(rnd(1,3)).add(V(rnd(-1,1),rnd(0,2),rnd(-1,1))), rnd(0.012,0.03), fl, rnd(4,8));
    FXS.dust.spawn({p, v:n.clone().multiplyScalar(0.9), life:rnd(1,2), s0:0.1, s1:0.6, col:[0.7,0.68,0.64], a0:0.45, a1:0, drag:2.2});
    FXS.decals.add(p, n, rnd(0.06,0.09), 2, null);
    FXS.spark.spawn({p, v:n.clone().multiplyScalar(2), life:0.08, s0:0.05, s1:0.02, col:[1,0.8,0.6], a0:0.8, a1:0});
    SND.hit(p, 'conc');
  } else if(surf === 'sand'){
    FXS.dust.spawn({p, v:n.clone().multiplyScalar(1.2).add(V(0,0.6,0)), life:rnd(1,1.8), s0:0.12, s1:0.7, col:[0.62,0.55,0.42], a0:0.55, a1:0, drag:2, g:-0.5});
    SND.hit(p, 'sand');
  } else if(surf === 'wood'){
    const fl = floorBelow(p);
    for(let i=0;i<3;i++) FXS.splinters.spawn(p, n.clone().multiplyScalar(rnd(0.5,2)).add(V(rnd(-.6,.6),rnd(0,1),rnd(-.6,.6))),
      V(rnd(0.03,0.08), rnd(0.003,0.007), rnd(0.006,0.014)), fl, rnd(5,10));
    FXS.decals.add(p, n, rnd(0.06,0.08), 0, null);
    SND.hit(p, 'wood');
  } else if(surf === 'glass') SND.hit(p, 'glass');
}

/* ============================================================================
   ВЗРЫВ: ударная волна рвёт обшивку и брус, выбивает стёкла, раскидывает
   обломки, давит на флаги; огонь — по обстоятельствам.
============================================================================ */
export function explode(p, o={}){
  const R = o.radius ?? 6.0, P = o.power ?? 1.0;
  // зона разрушения заметно меньше зоны поражения: граната рвёт обшивку
  // в радиусе пары метров, дальше — только трясёт и сечёт осколками
  const Rb = R*0.42;
  for(const {ref, pos, d} of query(p, Rb)){
    const k = Math.pow(1 - d/Rb, 1.2);
    const dir = V().subVectors(pos, p).normalize();
    const dmg = 760*P*k;
    if(ref.t === 'c'){ ref.s.char[ref.k] = Math.max(ref.s.char[ref.k], 0.25*k*P);
      damageChunk(ref.s, ref.k, dmg*(0.7+Math.random()*0.6), dir, P*k*1.4, 'blast'); }
    else if(ref.t === 'b'){ ref.b.hp -= dmg*0.8*ref.b.fragile; if(ref.b.hp <= 0) breakBeam(ref.b, pos.clone().lerp(p, 0.3), dir, P*k*1.4, 'blast'); }
    else if(ref.t === 'p'){ ref.p.hp -= dmg; if(ref.p.hp <= 0) breakProp(ref.p, p, dir, P*k*1.4, 'blast'); }
  }
  for(const {ref, pos, d} of query(p, R*1.6, r=>r.t==='g')){
    if(Math.random() < 1 - d/(R*1.6)*0.7) shatterGlass(ref.g, pos, V().subVectors(pos,p).normalize(), 1.5*(1-d/(R*1.6)));
  }
  flushDestruction();
  blastImpulse(p, R*1.3, 28*P);
  pokeCloth(p, R*2.5, 60*P);
  if(HOOKS.playerBlast) HOOKS.playerBlast(p, R, P);
  charSphere(p, R*0.45, 0.35*P, 0.15);
  if(HOOKS.ignite){
    if(o.fire) HOOKS.ignite(p, o.fire, R*0.5);
    else if(Math.random() < 0.45*P) HOOKS.ignite(p, 0.5, R*0.4);
  }
}
export function burnDamage(ref, dmg, dir){
  if(ref.t==='c') damageChunk(ref.s, ref.k, dmg, dir||V(0,-1,0), 0.2, 'fire');
  else if(ref.t==='b'){ ref.b.hp -= dmg; if(ref.b.hp <= 0) breakBeam(ref.b, null, dir||V(0,-1,0), 0.2, 'fire'); }
  else if(ref.t==='p'){ ref.p.hp -= dmg*ref.p.burnHp; if(ref.p.hp <= 0) breakProp(ref.p, null, V(0,1,0), 0.3, 'fire'); }
}

/* ============================================================================
   ОБУГЛИВАНИЕ: вершины в радиусе темнеют, трещины тлеют, пока есть жар.
============================================================================ */
const HOT = new Map();
function burnRange(mesh, start, count, p, r, dChar, heat){
  const pa = mesh.geometry.attributes.position, ba = mesh.geometry.attributes.aBurn;
  if(!ba) return 0;
  let maxC = 0;
  for(let i=start;i<start+count;i++){
    _a.fromBufferAttribute(pa, i);
    const d = _a.distanceTo(p);
    if(d > r){ maxC = Math.max(maxC, ba.getX(i)); continue; }
    const k = 1 - d/r;
    const c = Math.min(1, ba.getX(i) + dChar*k);
    ba.setXY(i, c, Math.max(ba.getY(i), heat*k)); maxC = Math.max(maxC, c);
  }
  ba.addUpdateRange(start*2, count*2); ba.needsUpdate = true;
  if(heat > 0) HOT.set(mesh.uuid+':'+start, {mesh, start, count});
  return maxC;
}
export function charSphere(p, r, dChar, heat){
  for(const {ref} of query(p, r+0.4)){
    if(ref.t === 'c'){ const s = ref.s; if(!s.mesh) continue;
      s.char[ref.k] = burnRange(s.mesh, s.base + ref.k*CV, CV, p, r, dChar, heat); }
    else if(ref.t === 'b' && ref.b.wood && ref.b.mesh){ const b = ref.b; b.char = burnRange(b.mesh, b.base, b.count, p, r, dChar, heat); }
  }
}
let _coolT = 0;
export function coolDown(dt){
  _coolT += dt; if(_coolT < 0.3) return;
  const k = Math.exp(-_coolT*0.22); _coolT = 0;
  for(const [key, h] of HOT){
    const ba = h.mesh.geometry.attributes.aBurn; let any = false;
    for(let i=h.start;i<h.start+h.count;i++){ const y = ba.getY(i)*k; ba.setY(i, y < 0.02 ? 0 : y); if(y >= 0.02) any = true; }
    ba.addUpdateRange(h.start*2, h.count*2); ba.needsUpdate = true;
    if(!any) HOT.delete(key);
  }
}
