// Расстановка: базы ALPHA (запад) и DELTA (восток), укрытия в пролётах,
// техника, склад ГСМ, ворота ангара, мебель и мишени внутри здания.
// Всё ставится центрально-симметрично: (x, z) → (−x, −z), чтобы у обеих
// команд были одинаковые линии укрытий и одинаковые пути к зданию.
import { THREE, scene, Q, rnd, sr } from './engine.js';
import { M, cmat } from './materials.js';
import { addBox, addOBB, addAABB, bucket, uvBox, beamBetween, roundedBox } from './builder.js';
import { HW, HD, WALL_H, floodMast, nightMat } from './hangar.js';
import { F2, BX0, BX1, BZ0, BZ1 } from './house.js';
import * as P from './props.js';
import * as P2 from './props2.js';
import { texOf, emblemDataURL, cv } from './textures.js';

const V = (x=0,y=0,z=0)=> new THREE.Vector3(x,y,z);
/** Ставит объект и его центрально-симметричную копию. */
const sym = (fn, x, z, rotY=0, ...rest)=>{ fn(x, z, rotY, ...rest); fn(-x, -z, rotY+Math.PI, ...rest); };

export const TEAMS = {
  ALPHA: { name:'ALPHA', color:'#d7dde4', accent:0xbfd4ee, side:-1, flag:{x:-31.2, z:-2.3},
           spawns:[ {id:'A1', name:'Бункер', x:-35.4, z:0}, {id:'A2', name:'Север', x:-34.2, z:-14.5}, {id:'A3', name:'Юг', x:-34.2, z:14.5} ] },
  DELTA: { name:'DELTA', color:'#a9cf86', accent:0xb8e08c, side: 1, flag:{x: 31.2, z:2.3},
           spawns:[ {id:'D1', name:'Бункер', x: 35.4, z:0}, {id:'D2', name:'Север', x: 34.2, z:-14.5}, {id:'D3', name:'Юг', x: 34.2, z:14.5} ] }
};
export const TEAM_LIGHTS = [], GATES = [], TEAM_SPOTS = [];

/* ---------- морской контейнер 20 футов ---------- */
const _contMats = {};
export function container(x, z, rotY, col=0x5b6f7a, y=0){
  let mat = _contMats[col];
  if(!mat){
    // свой материал на основе карт профлиста: цвет краски + рёбра нормалями
    mat = new THREE.MeshStandardMaterial({ map: M.corr.map, normalMap: M.corr.normalMap, normalScale: new THREE.Vector2(1.1,1.1),
      color: new THREE.Color(col).multiplyScalar(4.2), roughness: .78, metalness: .15, envMapIntensity: .7 });
    _contMats[col] = mat; }
  const L = 6.06, W = 2.44, H = 2.59;
  const G = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(L-0.1, H-0.12, W-0.08), mat);
  const uv = body.geometry.attributes.uv; for(let i=0;i<uv.count;i++) uv.setXY(i, uv.getX(i)*3, uv.getY(i)*1.3);
  body.position.y = H/2; G.add(body);
  const frame = cmat(0x4a4d4f, {roughness:.7, metalness:.4});
  for(const sx of [-1,1]) for(const sz of [-1,1]){
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, H, 0.16), frame); post.position.set(sx*(L/2-0.08), H/2, sz*(W/2-0.08)); G.add(post);
    const cast = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.12,0.18), frame); cast.position.set(sx*(L/2-0.08), H-0.06, sz*(W/2-0.08)); G.add(cast);
  }
  for(const yy of [0.08, H-0.08]) for(const sz of [-1,1]){ const r = new THREE.Mesh(new THREE.BoxGeometry(L, 0.14, 0.12), frame); r.position.set(0, yy, sz*(W/2-0.06)); G.add(r); }
  // двери с запорными штангами
  for(const sz of [-1,1]){
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.05, H-0.3, W/2-0.1), mat); d.position.set(L/2-0.02, H/2, sz*W/4); G.add(d);
    for(const o of [-0.35,0.35]){ const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,H-0.2,6), M.steel); bar.position.set(L/2+0.03, H/2, sz*W/4+o*0.6); G.add(bar); }
  }
  G.position.set(x, y, z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  scene.add(G);
  addAABB(x, y+H/2, z, L, H, W, rotY, 'metal');
}

/* ---------- топливная ёмкость на ложементах ---------- */
function fuelTank(x, z, rotY){
  const G = new THREE.Group();
  const mat = cmat(0x6e6a56, {roughness:.55, metalness:.45});
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 4.6, 24), mat); tank.rotation.z = Math.PI/2; tank.position.y = 1.35; G.add(tank);
  for(const s of [-1,1]){ const cap = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 10), mat); cap.scale.set(0.3,1,1); cap.position.set(s*2.3, 1.35, 0); G.add(cap);
    const sad = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.55, 1.8), M.panel); sad.position.set(s*1.4, 0.28, 0); G.add(sad); }
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,0.15,14), M.dark); hatch.position.set(0.6, 2.4, 0); G.add(hatch);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,1.3,8), M.steel); pipe.position.set(-1.4, 0.7, 0.9); G.add(pipe);
  G.position.set(x,0,z); G.rotation.y = rotY; G.traverse(o=>{ if(o.isMesh){ o.castShadow = o.receiveShadow = true; } }); scene.add(G);
  addAABB(x, 1.2, z, 5.2, 2.4, 2.0, rotY, 'metal');
}

/* ---------- база команды: навес с габионами, флагшток, разметка ---------- */
function floorMark(tex, x, z, w, h, rotY, opacity=0.8){
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({map:tex, transparent:true, opacity,
    depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2, roughness:.9}));
  m.rotation.x = -Math.PI/2; m.rotation.z = rotY; m.position.set(x, 0.012, z); m.receiveShadow = true; m.userData.nomerge = true;
  scene.add(m);
}
function emblemFloorTex(team){
  const [c,x] = cv(512,512);
  x.clearRect(0,0,512,512);
  const col = team==='ALPHA' ? 'rgba(220,226,232,0.85)' : 'rgba(160,200,120,0.85)';
  const img = new Image();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  img.onload = ()=>{ x.globalAlpha = 0.9; x.drawImage(img, 56, 20, 400, 400);
    x.globalAlpha = 1; x.fillStyle = col; x.font = '700 64px "Segoe UI",Arial'; x.textAlign='center'; x.fillText(team, 256, 490);
    // потёртость краски колёсами и подошвами
    x.globalCompositeOperation = 'destination-out';
    for(let i=0;i<500;i++){ x.fillStyle = `rgba(0,0,0,${Math.random()*0.5})`; x.fillRect(Math.random()*512, Math.random()*512, 2+Math.random()*40, 1+Math.random()*4); }
    x.globalCompositeOperation = 'source-over'; t.needsUpdate = true; };
  img.src = emblemDataURL(team, 256);
  return t;
}
function stripeTex(col){
  const [c,x] = cv(256,32);
  x.fillStyle = col; x.fillRect(0,0,256,32);
  x.globalCompositeOperation = 'destination-out';
  for(let i=0;i<120;i++){ x.fillStyle = `rgba(0,0,0,${Math.random()*0.6})`; x.fillRect(Math.random()*256, Math.random()*32, 2+Math.random()*14, 1+Math.random()*3); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}
function base(teamKey){
  const T = TEAMS[teamKey], s = T.side;         // s = -1 запад, +1 восток
  const X = v => v*(-s);                        // координаты базы ALPHA, зеркалим для DELTA
  const bx = s*35.4;
  // бетонная площадка навеса
  addBox('conc', bx, 0.04, 0, 6.4, 0.08, 8.6, {d:.4, collide:false});
  addOBB(bx, 0.04, 0, 6.4, 0.08, 8.6, null, 'conc');
  // каркас навеса и кровля из профлиста
  for(const px of [bx-2.9, bx+2.9]) for(const pz of [-4.0, 4.0]){
    addBox('steel', px, 1.45, pz, 0.14, 2.9, 0.14, {d:1.1});
  }
  for(const pz of [-4.0, 4.0]) addBox('steel', bx, 2.95, pz, 6.1, 0.18, 0.12, {collide:false, d:1});
  for(const px of [bx-2.9, bx, bx+2.9]) addBox('steel', px, 3.0, 0, 0.12, 0.16, 8.3, {collide:false, d:1});
  addBox('roof', bx, 3.12, 0, 6.8, 0.05, 9.0, {collide:false, d:.5});
  addOBB(bx, 3.12, 0, 6.8, 0.1, 9.0, null, 'metal');
  // габионы по бокам и сзади — защита точки возрождения
  P2.hesco(bx, -4.7, 0, 5, 1.6); P2.hesco(bx, 4.7, 0, 5, 1.6);
  // фронт: мешки с песком посередине, по бокам два прохода
  P2.sandbagWall(bx - s*3.6, 0, Math.PI/2, 2.4, 6);
  // лампа в цвете команды под навесом
  const lampMat = new THREE.MeshStandardMaterial({color:0x222222, emissive:T.accent, emissiveIntensity:2.2});
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.16), lampMat); lamp.position.set(bx, 2.88, 0); lamp.userData.nomerge = true; scene.add(lamp);
  const L = new THREE.PointLight(T.accent, 12, 12, 1.6); L.position.set(bx, 2.6, 0); scene.add(L); TEAM_LIGHTS.push(L);
  // флагшток перед навесом
  const fx = T.flag.x, fz = T.flag.z;
  addBox('conc', fx, 0.15, fz, 1.2, 0.3, 1.2, {d:.6});
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 8.0, 12), M.chrome);
  pole.position.set(fx, 4.3, fz); pole.castShadow = true; scene.add(pole);
  addOBB(fx, 4.3, fz, 0.14, 8.0, 0.14, null, 'metal');
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), cmat(0xb8a060,{metalness:.8, roughness:.3}));
  finial.position.set(fx, 8.36, fz); scene.add(finial);
  // фал вдоль мачты
  const hal = new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006,7.6,4), M.cable); hal.position.set(fx + 0.07*s*-1, 4.3, fz+0.05); scene.add(hal);
  // эмблема на полу и граница зоны
  floorMark(emblemFloorTex(teamKey), s*28.4, 0, 4.4, 4.4, s < 0 ? -Math.PI/2 : Math.PI/2, 0.75);
  const st = stripeTex(teamKey==='ALPHA' ? '#d9dee4' : '#9cc27a'); st.repeat.set(10,1);
  floorMark(st, s*25.9, 0, 0.22, 22, 0, 0.85);
  // прожектор в цвете команды над базой
  const sp = new THREE.SpotLight(T.accent, 0, 40, 0.7, 0.6, 1.2);
  sp.position.set(s*38.5, 8.5, 0); sp.target.position.set(s*30, 0, 0); scene.add(sp); scene.add(sp.target);
  TEAM_SPOTS.push(sp);
  // ящик с боеприпасами и носилки у задней стены
  P2.dynBox(bx + s*1.8, 0.08, -3.3, 0.1, [0.7,0.35,0.4], M.teamD);
  P2.dynBox(bx + s*1.8, 0.08, 3.3, -0.1, [0.7,0.35,0.4], M.teamD);
}

/* ---------- ворота ангара: приоткрытая створка, за ней дневной свет ---------- */
function hangarGate(sx){
  const x = sx*(HW-0.3);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 6.6), new THREE.MeshBasicMaterial({color:0xfff6e4}));
  outside.position.set(sx*(HW+0.25), 3.3, 1.2); outside.rotation.y = sx>0 ? -Math.PI/2 : Math.PI/2; outside.userData.nomerge = true; scene.add(outside);
  for(const [z0,z1] of [[-6.2, 0.4], [2.0, 6.2]]){
    const zc = (z0+z1)/2, w = z1-z0;
    addBox('corr', x + sx*0.05, 3.4, zc, 0.12, 6.8, w, {d:.45, surf:'metal'});
    for(let i=0;i<4;i++) addBox('steel', x - sx*0.03, 0.8 + i*1.8, zc, 0.08, 0.12, w, {collide:false, d:1});
  }
  addBox('steel', x - sx*0.05, 7.0, 0, 0.3, 0.35, 13.0, {collide:false, d:1});   // направляющая
  for(const z of [-6.4, 6.4]) addBox('steel', x - sx*0.05, 3.5, z, 0.3, 7.0, 0.3, {d:1});
  // в щель ворот бьёт свет — длинная полоса на бетоне
  const beam = new THREE.SpotLight(0xfff0d8, 30, 30, 0.22, 0.7, 1.1);
  beam.position.set(sx*(HW+2), 4.5, 1.2); beam.target.position.set(sx*(HW-12), 0, 1.2);
  scene.add(beam); scene.add(beam.target);
  GATES.push({plane:outside, beam});
  addOBB(sx*(HW-0.1), 3.3, 1.2, 0.3, 6.6, 1.6, null, 'metal', {playerOnly:true});
  addOBB(sx*(HW+1.0), 3.0, 1.2, 0.3, 6.0, 2.4, null, 'metal', {noPlayer:true});
}

export function buildLayout(){
  P.setHeliHook((x,y,z,r)=> P2.helicopter(x,y,z,r));
  base('ALPHA'); base('DELTA');
  hangarGate(-1); hangarGate(1);

  /* --- фланговые точки возрождения: контейнер + габионы --- */
  sym((x,z,r)=> container(x, z, r, 0x5b6f7a), -34.0, -18.2, 0);
  sym((x,z,r)=> P2.hesco(x, z, r, 2, 1.45), -30.4, -14.5, Math.PI/2);
  sym((x,z,r)=> P.cabin(x, 0, z, r, 2.4, 5.2, 2.5, 0x717a6c), -34.2, 18.3, 0);
  sym((x,z,r)=> P2.hesco(x, z, r, 2, 1.45), -30.4, 14.5, Math.PI/2);
  sym((x,z,r)=> P2.crate(x, 0, z, r, 0.9), -36.6, -12.2, 0.2);
  sym((x,z,r)=> P2.crate(x, 0, z, r, 0.8), -36.4, 12.4, -0.3);

  /* --- рубеж выхода с базы --- */
  sym((x,z,r)=> P2.hesco(x, z, r, 3, 1.35), -27.4, -7.0, Math.PI/2);
  sym((x,z,r)=> P2.hesco(x, z, r, 3, 1.35), -27.4, 7.0, Math.PI/2);
  sym((x,z,r)=> P2.sandbagWall(x, z, r, 2.4, 5), -24.6, 0, Math.PI/2);
  sym((x,z,r)=> P.jerseyBarrier(x, 0, z, r), -22.5, -4.2, Math.PI/2+0.1);
  sym((x,z,r)=> P.jerseyBarrier(x, 0, z, r), -22.8, 4.0, Math.PI/2-0.1);

  /* --- СЗ угол: склад ГСМ (взрывоопасные бочки) --- */
  sym((x,z,r)=> fuelTank(x, z, r), -33.5, -26.2, 0);
  for(const [bx,bz] of [[-29.0,-27.4],[-28.4,-26.8],[-29.5,-26.6],[-27.6,-27.6],[-26.2,-27.5]]){
    P2.fuelBarrel(bx, 0, bz, rnd(0,6)); P2.fuelBarrel(-bx, 0, -bz, rnd(0,6));
  }
  sym((x,z,r)=> P2.sandbagWall(x, z, r, 3.0, 4), -27.2, -24.6, 0);
  sym((x,z,r)=> P2.palletStack(x, 0, z, r, 4), -24.2, -27.6, 0.2);

  /* --- северный пролёт (и центрально-симметричный южный) --- */
  sym((x,z,r)=> container(x, z, r, 0x7a5a42), -21.5, -16.4, 0.15);
  sym((x,z,r)=> container(x, z, r, 0x4f5f4a, 2.59), -21.3, -16.6, 0.18);
  sym((x,z,r)=> container(x, z, r, 0x6d7478), -21.8, -23.5, -0.1);
  sym((x,z,r)=> P.carWreck(x, 0, z, r), -14.8, -22.8, 0.5);
  sym((x,z,r)=> P.blockWall(x, z, r, 6.0, 2), -13.5, -14.6, 0.08);
  sym((x,z,r)=> P2.barricade(x, 0, z, r, 2.4), -18.6, -11.4, 0.1);
  sym((x,z,r)=> P2.crate(x, 0, z, r, 1.0), -10.6, -12.9, 0.3);
  sym((x,z,r)=> P2.crate(x, 0, z, r, 0.8), -10.0, -12.0, -0.2);
  sym((x,z,r)=> P.pipeStack(x, 0, z, r, 3), -3.5, -25.5, Math.PI/2);
  sym((x,z,r)=> P2.sandbagWall(x, z, r, 3.0, 4), -2.2, -19.6, 0.05);
  sym((x,z,r)=> P.jerseyBarrier(x, 0, z, r), 3.6, -14.4, 0.2);
  sym((x,z,r)=> P.cabin(x, 0, z, r, 2.4, 5.6, 2.5, 0x7d7460), 11.5, -23.5, Math.PI+0.05);
  sym((x,z,r)=> P2.barricade(x, 0, z, r, 2.4), 10.2, -13.0, -0.12);
  sym((x,z,r)=> P2.palletStack(x, 0, z, r, 5), 16.2, -12.8, 0.3);
  sym((x,z,r)=> P.pickup(x, 0, z, r, M.carSand), -8.5, -27.0, 0.08);
  sym((x,z,r)=> P.van(x, 0, z, r, M.carWhite), 5.0, -26.8, Math.PI-0.05);
  sym((x,z,r)=> P2.hesco(x, z, r, 2, 1.35), 0.5, -13.3, 0);

  /* --- ЮЗ угол: вертолётная площадка (и её пара на СВ) --- */
  P.helipad(-21.0, 20.6); P.helipad(21.0, -20.6);

  /* --- западный/восточный фасады: укрытия у дверей --- */
  sym((x,z,r)=> P2.barricade(x, 0, z, r, 2.0), -18.0, 3.2, Math.PI/2);
  sym((x,z,r)=> P2.crate(x, 0, z, r, 0.9), -17.6, -4.4, 0.1);
  sym((x,z,r)=> P2.table(x, 0, z, r, true), -17.8, 6.8, Math.PI/2);

  /* --- мелочь с физикой --- */
  const dyn = [
    ()=>P2.dynBarrel(-25.4,0,-13.0), ()=>P2.dynBarrel(-25.9,0,-12.5,0x3a5470), ()=>P2.dynBarrel(-12.2,0,-18.5,0x8a8b86,true),
    ()=>P2.dynCone(-16.4,0,-10.8), ()=>P2.dynCone(-15.2,0,-10.6), ()=>P2.dynCone(-6.2,0,-12.6),
    ()=>P2.dynTire(-18.8,0,-19.2), ()=>P2.dynTire(-19.4,0,-18.6), ()=>P2.dynBox(-9.2,0,-17.4,0.3),
    ()=>P2.dynBarrel(-2.8,0,-14.2,0x6e3630), ()=>P2.dynCone(4.4,0,-11.6)
  ];
  for(const f of dyn) f();
  // зеркальные копии — через подмену координат
  const mir = [[25.4,0,13.0],[25.9,0,12.5],[12.2,0,18.5],[16.4,0,10.8],[15.2,0,10.6],[6.2,0,12.6],[18.8,0,19.2],[19.4,0,18.6],[9.2,0,17.4],[2.8,0,14.2],[-4.4,0,11.6]];
  P2.dynBarrel(...mir[0]); P2.dynBarrel(...mir[1],0x3a5470); P2.dynBarrel(...mir[2],0x8a8b86,true);
  P2.dynCone(...mir[3]); P2.dynCone(...mir[4]); P2.dynCone(...mir[5]); P2.dynTire(...mir[6]); P2.dynTire(...mir[7]);
  P2.dynBox(...mir[8], 0.3); P2.dynBarrel(...mir[9], 0x6e3630); P2.dynCone(...mir[10]);

  /* --- строительный быт вдоль стен ангара --- */
  sym((x,z,r)=> P.lumberPile(x, 0, z, r, 3.4, 7), -12.0, -28.6, 0);
  sym((x,z,r)=> P.osbStack(x, 0, z, r, 12), -6.8, -28.7, 0);
  sym((x,z,r)=> P.sawhorse(x, 0, z, r), -9.3, -28.2, 0.2);
  sym((x,z,r)=> P.cableDrum(x, 0, z), 12.5, -28.4, 0);
  sym((x,z,r)=> P.compressor(x, 0, z, r), 15.5, -28.6, 0.4);
  sym((x,z,r)=> P.toolCart(x, 0, z, r), 18.2, -28.4, 0.1);
  sym((x,z,r)=> P.siteToilet(x, 0, z, r), 38.6, -27.5, -Math.PI/2);
  sym((x,z,r)=> P.extinguisher(x, 0, z, r), -39.5, -9.0, Math.PI/2);

  buildInterior();
}

/* ---------- внутри здания: укрытия, мебель, мишени ---------- */
function buildInterior(){
  const y2 = F2;
  const S = (fn, x, y, z, r, ...a)=>{ fn(x, y, z, r, ...a); fn(-x, y, -z, r+Math.PI, ...a); };
  // 1 этаж
  S(P2.target, -11.0, 0, -8.8, 0);
  S(P2.table,  -11.8, 0, -4.4, Math.PI/2, true);
  S(P2.barricade, -7.1, 0, -4.2, 0, 2.0);
  S(P2.target, -5.3, 0, -8.9, 0);
  S(P2.palletStack, -14.2, 0, 8.6, 0.1, 4);
  S(P2.table, -12.4, 0, 5.6, 0, false);
  S(P2.target, -10.5, 0, 8.9, Math.PI);
  S(P2.barricade, -7.2, 0, 6.4, 0, 1.6);
  S(P2.crate, -5.2, 0, 2.1, 0.2, 0.8);
  S(P2.crate, -3.6, 0, -8.7, 0.1, 0.9);
  S(P2.target, -1.0, 0, -8.9, 0);
  S(P2.palletStack, -2.2, 0, 0.9, 0.35, 4);
  S(P2.barricade, 2.6, 0, -2.2, 0.1, 1.6);
  // 2 этаж
  S(P2.target, -10.4, y2, -2.1, Math.PI);
  S(P2.crate, -10.3, y2, -8.9, 0.1, 0.8);
  S(P2.barricade, -7.2, y2, -5.4, 0, 1.8);
  S(P2.target, -5.2, y2, -8.9, 0);
  S(P2.table, -12.4, y2, 5.2, 0, true);
  S(P2.crate, -14.3, y2, 8.8, 0.3, 0.8);
  S(P2.target, -7.0, y2, 8.9, Math.PI);
  S(P2.palletStack, -3.5, y2, -8.7, 0.1, 3);
  S(P2.target, -1.2, y2, -8.9, 0);
}
