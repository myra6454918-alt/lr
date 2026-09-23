// Сборка статической геометрии: вёдра по материалам, запекание по ячейкам,
// реестр коллайдеров (ориентированные боксы → статические тела Ammo).
import { THREE, scene, clamp } from './engine.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { M } from './materials.js';

export const BUCKET = new Map();
/** Коллайдеры. Формат: {cx,cy,cz, hx,hy,hz, q:[x,y,z,w]|null, surf, x0..z1 (AABB)}.
    Старый формат {x0,y0,z0,x1,y1,z1} тоже принимается и переводится в бокс. */
export const COLLIDERS = [];
export const SHOOTABLE = [];
export const bucket = k => { if(!BUCKET.has(k)) BUCKET.set(k,[]); return BUCKET.get(k); };
export const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();

/** Материал поверхности для попаданий и звука шагов. */
export function surfOf(matKey){
  if(!matKey) return 'conc';
  if(/osb|wood|ply/i.test(matKey)) return 'wood';
  if(/steel|dark|corr|roof|grating|hazard|chrome|teamA|teamD/i.test(matKey)) return 'metal';
  if(/sand|bag|hesco|tarp|dirt/i.test(matKey)) return 'sand';
  if(/glass/i.test(matKey)) return 'glass';
  return 'conc';
}

/** UV по мировому размеру: текстура не растягивается на больших гранях. */
export function uvBox(g, sx,sy,sz, d, alignGrain){
  const uv = g.attributes.uv;
  const s = [[sz,sy],[sz,sy],[sx,sz],[sx,sz],[sx,sy],[sx,sy]];
  for(let f=0; f<6; f++) for(let i=0;i<4;i++){
    const k = f*4+i;
    let u = uv.getX(k)*s[f][0]*d, v = uv.getY(k)*s[f][1]*d;
    if(alignGrain && s[f][1] > s[f][0]){ const t=u; u=v; v=t; }
    uv.setXY(k, u, v);
  }
  uv.needsUpdate = true;
}
export function tintGeo(g, r, gg, b){
  const n = g.attributes.position.count;
  const col = new Float32Array(n*3);
  for(let i=0;i<n;i++){ col[i*3]=r; col[i*3+1]=gg; col[i*3+2]=b; }
  g.setAttribute('color', new THREE.BufferAttribute(col,3));
  return g;
}
/** Бокс в ведро материала. o.rotX/Y/Z — поворот, o.collide=false — без коллайдера,
    o.tint — вершинный цвет, o.d — плотность UV, o.surf — тип поверхности. */
export function addBox(mat, cx,cy,cz, sx,sy,sz, o={}){
  const g = new THREE.BoxGeometry(sx,sy,sz);
  uvBox(g, sx,sy,sz, o.d ?? 0.5, o.grain);
  if(o.rotY || o.rotX || o.rotZ){ _e.set(o.rotX||0, o.rotY||0, o.rotZ||0, o.order||'XYZ'); _q.setFromEuler(_e); }
  else _q.identity();
  _m4.compose(_v.set(cx,cy,cz), _q, new THREE.Vector3(1,1,1));
  g.applyMatrix4(_m4);
  if(o.tint) tintGeo(g, o.tint[0], o.tint[1], o.tint[2]);
  bucket(mat).push(g);
  if(o.collide !== false){
    addOBB(cx,cy,cz, sx,sy,sz, (o.rotY||o.rotX||o.rotZ) ? _q.clone() : null, o.surf || surfOf(mat), o);
  }
  return g;
}
/** Ориентированный коллайдер. q — THREE.Quaternion или null. */
export function addOBB(cx,cy,cz, sx,sy,sz, q=null, surf='conc', extra={}){
  const hx=sx/2, hy=sy/2, hz=sz/2;
  const c = {cx,cy,cz,hx,hy,hz, q: q ? [q.x,q.y,q.z,q.w] : null, surf};
  if(extra.noPlayer) c.noPlayer = true;
  if(extra.playerOnly) c.playerOnly = true;
  // AABB для быстрых запросов (опоры реквизита, миникарта)
  if(q){
    const m = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)).elements;
    const ex = Math.abs(m[0])*hx + Math.abs(m[3])*hy + Math.abs(m[6])*hz;
    const ey = Math.abs(m[1])*hx + Math.abs(m[4])*hy + Math.abs(m[7])*hz;
    const ez = Math.abs(m[2])*hx + Math.abs(m[5])*hy + Math.abs(m[8])*hz;
    Object.assign(c, {x0:cx-ex,y0:cy-ey,z0:cz-ez,x1:cx+ex,y1:cy+ey,z1:cz+ez});
  } else Object.assign(c, {x0:cx-hx,y0:cy-hy,z0:cz-hz,x1:cx+hx,y1:cy+hy,z1:cz+hz});
  COLLIDERS.push(c);
  return c;
}
/** Коллайдер по центру, размерам и повороту вокруг Y (точный, без раздувания AABB). */
export function addAABB(cx,cy,cz,sx,sy,sz,rotY=0,surf='conc'){
  return addOBB(cx,cy,cz,sx,sy,sz, rotY ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), rotY) : null, surf);
}
/** Нормализует коллайдер старого формата (только AABB). */
export function normCollider(c){
  if(c.hx !== undefined) return c;
  c.cx=(c.x0+c.x1)/2; c.cy=(c.y0+c.y1)/2; c.cz=(c.z0+c.z1)/2;
  c.hx=(c.x1-c.x0)/2; c.hy=(c.y1-c.y0)/2; c.hz=(c.z1-c.z0)/2; c.q=null; c.surf=c.surf||'conc';
  return c;
}
/** Бокс между двумя точками (раскосы, поручни, косоуры). */
export function beamBetween(mat, a, b, w, h, o={}){
  const dir = new THREE.Vector3().subVectors(b,a), len = dir.length();
  const g = new THREE.BoxGeometry(w, h, len);
  uvBox(g, w, h, len, o.d ?? 1.0, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), dir.normalize());
  if(o.roll){ q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), o.roll)); }
  const mid = new THREE.Vector3().addVectors(a,b).multiplyScalar(0.5);
  g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1,1,1)));
  if(o.tint) tintGeo(g, ...o.tint);
  bucket(mat).push(g);
  if(o.collide) addOBB(mid.x,mid.y,mid.z, w,h,len, q, o.surf || surfOf(mat));
  return g;
}

/* ---------------------------------------------------------------------------
   ЗАПЕКАНИЕ СТАТИКИ
   Геометрия сливается по «материал + ячейка 18 м (+ группа)». Геометрии с
   userData.onBaked узнают свой диапазон вершин в общем буфере: так
   разрушаемые куски остаются адресуемыми без отдельных мешей.
--------------------------------------------------------------------------- */
const BAKE_CELL = 18;
const KEEP = new Set(['position','normal','uv','color','aBurn']);
function unifyIndexing(list){
  if(!list.some(g=>!g.index)) return list;
  return list.map(g=>{
    if(!g.index) return g;
    const out = g.toNonIndexed(); out.userData = g.userData; return out;
  });
}
function normalizeAttrs(list, withColor, withBurn){
  for(const g of list){
    for(const k of Object.keys(g.attributes)) if(!KEEP.has(k)) g.deleteAttribute(k);
    if(!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    if(!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n*2), 2));
    if(withColor && !g.attributes.color) tintGeo(g,1,1,1);
    if(!withColor && g.attributes.color) g.deleteAttribute('color');
    if(withBurn && !g.attributes.aBurn) g.setAttribute('aBurn', new THREE.BufferAttribute(new Float32Array(n*2), 2));
    if(!withBurn && g.attributes.aBurn) g.deleteAttribute('aBurn');
  }
}
export const BAKED = [];
export function bakeGroups(entries, tag){
  const needColor = new Set();
  for(const e of entries) if(e.geo.attributes.color) needColor.add(e.mat.uuid);
  const cells = new Map();
  const _c = new THREE.Vector3();
  for(const e of entries){
    e.geo.computeBoundingSphere();
    _c.copy(e.geo.boundingSphere.center);
    const grp = (e.geo.userData && e.geo.userData.group) || '';
    const key = e.mat.uuid+'|'+Math.floor(_c.x/BAKE_CELL)+'|'+Math.floor(_c.z/BAKE_CELL)
              +'|'+(e.cast?1:0)+(e.recv?1:0)+'|'+(e.order||0)+'|'+grp;
    let c = cells.get(key);
    if(!c){ c = {mat:e.mat, cast:e.cast, recv:e.recv, order:e.order||0, list:[]}; cells.set(key,c); }
    c.list.push(e.geo);
  }
  let made = 0;
  for(const c of cells.values()){
    const wc = needColor.has(c.mat.uuid);
    if(wc) c.mat.vertexColors = true;
    const wb = !!c.mat.userData.burnable;
    normalizeAttrs(c.list, wc, wb);
    c.list = unifyIndexing(c.list);
    let off = 0; const hooks = [];
    for(const g of c.list){
      const n = g.attributes.position.count;
      if(g.userData && g.userData.onBaked) hooks.push([g.userData.onBaked, off, n]);
      off += n;
    }
    const merged = c.list.length === 1 ? c.list[0] : BGU.mergeGeometries(c.list, false);
    if(!merged){ console.warn('merge failed', c.mat.name); continue; }
    merged.computeBoundingSphere(); merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, c.mat);
    mesh.castShadow = c.cast; mesh.receiveShadow = c.recv;
    mesh.renderOrder = c.order; mesh.name = tag;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    scene.add(mesh); SHOOTABLE.push(mesh); BAKED.push(mesh); made++;
    for(const [fn, start, count] of hooks) fn(mesh, start, count);
  }
  return made;
}
export function flushBuckets(){
  const entries = [];
  for(const [k, arr] of BUCKET){
    const mat = M[k];
    if(!mat){ console.warn('no material', k); arr.length = 0; continue; }
    for(const g of arr) entries.push({geo:g, mat, cast: !(g.userData&&g.userData.noShadow), recv:true, order:0});
    arr.length = 0;
  }
  return bakeGroups(entries, 'baked_bucket');
}
/** Второй проход: сливает отдельные Mesh, добавленные в сцену напрямую.
    Всё, что двигается или разрушается, помечено userData.nomerge. */
export function bakeScene(){
  const loose = [];
  scene.traverse(o=>{
    if(!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    let p = o, skip = false;
    while(p){ if(p.userData && p.userData.nomerge){ skip = true; break; } p = p.parent; }
    if(skip) return;
    if(o.name === 'sky' || o.name.startsWith('baked')) return;
    if(!o.geometry || !o.geometry.attributes.position) return;
    if(Array.isArray(o.material)) return;
    if(o.material.transparent && o.material.depthWrite === false) return;
    loose.push(o);
  });
  const entries = [];
  for(const o of loose){
    o.updateWorldMatrix(true, false);
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    entries.push({geo:g, mat:o.material, cast:o.castShadow, recv:o.receiveShadow, order:o.renderOrder});
  }
  for(const o of loose){
    o.removeFromParent();
    const i = SHOOTABLE.indexOf(o); if(i>=0) SHOOTABLE.splice(i,1);
  }
  const empties = [];
  scene.traverse(o=>{ if(o.isGroup && o.children.length===0 && !o.userData.nomerge) empties.push(o); });
  for(const o of empties){ o.removeFromParent(); const i = SHOOTABLE.indexOf(o); if(i>=0) SHOOTABLE.splice(i,1); }
  return bakeGroups(entries, 'baked_loose');
}

/* --- пространственная сетка по AABB коллайдеров (опоры, проверки) --- */
const GRID = new Map(), CELL = 4;
const gkey = (ix,iz)=> ix*10007 + iz;
export function buildGrid(){
  GRID.clear();
  COLLIDERS.forEach((c,i)=>{
    normCollider(c);
    for(let ix=Math.floor(c.x0/CELL); ix<=Math.floor(c.x1/CELL); ix++)
      for(let iz=Math.floor(c.z0/CELL); iz<=Math.floor(c.z1/CELL); iz++){
        const k=gkey(ix,iz); if(!GRID.has(k)) GRID.set(k,[]); GRID.get(k).push(i);
      }
  });
}
export function nearCol(x,z,pad){
  const out=[], seen=new Set();
  for(let ix=Math.floor((x-pad)/CELL); ix<=Math.floor((x+pad)/CELL); ix++)
    for(let iz=Math.floor((z-pad)/CELL); iz<=Math.floor((z+pad)/CELL); iz++){
      const arr=GRID.get(gkey(ix,iz)); if(!arr) continue;
      for(const i of arr){ if(seen.has(i)) continue; seen.add(i); out.push(COLLIDERS[i]); }
    }
  return out;
}
export function roundedBox(w,h,d,r=0.12,seg=3){
  r = Math.min(r, w/2-0.001, h/2-0.001, d/2-0.001);
  const g = new THREE.BoxGeometry(w,h,d, seg*2, seg*2, seg*2);
  const p = g.attributes.position;
  const hw=w/2-r, hh=h/2-r, hd=d/2-r;
  const v = new THREE.Vector3();
  for(let i=0;i<p.count;i++){
    v.fromBufferAttribute(p,i);
    // точка проецируется на поверхность скруглённого параллелепипеда
    const cx = clamp(v.x,-hw,hw), cy = clamp(v.y,-hh,hh), cz = clamp(v.z,-hd,hd);
    const dx=v.x-cx, dy=v.y-cy, dz=v.z-cz;
    const l = Math.hypot(dx,dy,dz);
    if(l > 1e-6) p.setXYZ(i, cx+dx/l*r, cy+dy/l*r, cz+dz/l*r);
  }
  g.computeVertexNormals();
  return g;
}
/** Колесо: покрышка с протектором + диск со спицами и ступицей. */
/** Меш без вершинного цвета на материале с vertexColors рисуется чёрным:
    добавляем белый цвет всем таким геометриям (реквизит, обломки, щепа). */
export function ensureColor(o){
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  if(!o.geometry || o.geometry.attributes.color) return;
  if(mats.some(m=>m && m.vertexColors)) tintGeo(o.geometry, 1, 1, 1);
}
