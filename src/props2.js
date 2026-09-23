// Новый реквизит: реалистичный вертолёт, габионы HESCO, укрытия баз, ломкие
// ящики и баррикады, мишени, динамические бочки/конусы/покрышки.
import { THREE, scene, Q, sr, srnd, clamp, rnd } from './engine.js';
import { M, cmat } from './materials.js';
import { addBox, addOBB, addAABB, bucket, uvBox, tintGeo, roundedBox, beamBetween } from './builder.js';
import { registerProp } from './destruction.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x=0,y=0,z=0)=> new THREE.Vector3(x,y,z);
export const DYN_PROPS = [];      // тела создаются после инициализации физики
const shadowAll = g => g.traverse(o=>{ if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });

/* ============================================================================
   ВЕРТОЛЁТ (лёгкий многоцелевой, силуэт UH-1): фюзеляж — лофт из
   суперэллипсов, остекление вырезается из того же лофта, хвостовая балка,
   киль с рулевым винтом, двухлопастный несущий винт со стабилизирующей
   штангой, лыжное шасси с дугами, лопасти притянуты швартовкой к балке.
============================================================================ */
function loft(sections, M_=40, glassTest=null){
  const S = sections.length, pos = [], uv = [];
  for(let i=0;i<S;i++){
    const s = sections[i];
    for(let j=0;j<=M_;j++){
      const th = j/M_*Math.PI*2, c = Math.cos(th), sn = Math.sin(th), e = 2/(s.sq||2.4);
      const z = s.w*Math.sign(c)*Math.pow(Math.abs(c), e), y = s.yc + (sn>0 ? s.ht : s.hb)*Math.sign(sn)*Math.pow(Math.abs(sn), e);
      pos.push(s.x, y, z); uv.push(i/(S-1)*4, j/M_*2);
    }
  }
  const body = [], glass = [];
  for(let i=0;i<S-1;i++) for(let j=0;j<M_;j++){
    const a=i*(M_+1)+j, b=a+1, c=a+(M_+1), d=c+1;
    const th = (j+0.5)/M_*Math.PI*2;
    const L = glassTest && glassTest(i, th) ? glass : body;
    L.push(a,c,b, b,c,d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
  g.setIndex([...body, ...glass]);
  g.addGroup(0, body.length, 0); g.addGroup(body.length, glass.length, 1);
  g.computeVertexNormals();
  return g;
}
export function helicopter(x, y, z, rotY){
  const G = new THREE.Group();
  const olive = new THREE.MeshStandardMaterial({color:0x5d6444, roughness:.66, metalness:.22, envMapIntensity:.9});
  const oliveDark = new THREE.MeshStandardMaterial({color:0x363a28, roughness:.75, metalness:.25});
  const glassM = new THREE.MeshStandardMaterial({color:0x7d949e, roughness:.05, metalness:.55, envMapIntensity:2.2,
    transparent:true, opacity:.5, side:THREE.DoubleSide, depthWrite:false});
  const metal = M.steel, black = M.darker;
  // сечения фюзеляжа: x (нос +), полуширина, верх/низ от оси, ось по высоте
  const secs = [
    {x: 3.55, w:0.05, ht:0.05, hb:0.05, yc:0.98, sq:2},
    {x: 3.45, w:0.30, ht:0.26, hb:0.30, yc:1.00, sq:2.1},
    {x: 3.15, w:0.62, ht:0.60, hb:0.45, yc:1.10, sq:2.3},
    {x: 2.65, w:0.92, ht:0.90, hb:0.58, yc:1.26, sq:2.7},
    {x: 1.90, w:1.10, ht:1.02, hb:0.66, yc:1.34, sq:3.2},
    {x: 1.10, w:1.16, ht:1.06, hb:0.68, yc:1.36, sq:3.6},
    {x:-0.60, w:1.16, ht:1.06, hb:0.68, yc:1.36, sq:3.6},
    {x:-1.55, w:1.10, ht:1.02, hb:0.60, yc:1.42, sq:3.4},
    {x:-2.30, w:0.86, ht:0.86, hb:0.36, yc:1.62, sq:2.8},
    {x:-3.10, w:0.52, ht:0.52, hb:0.30, yc:1.86, sq:2.4},
    {x:-4.60, w:0.34, ht:0.36, hb:0.28, yc:2.00, sq:2.2},
    {x:-6.60, w:0.24, ht:0.26, hb:0.22, yc:2.10, sq:2.0},
    {x:-8.00, w:0.18, ht:0.2,  hb:0.18, yc:2.16, sq:2.0},
    {x:-8.12, w:0.02, ht:0.02, hb:0.02, yc:2.16, sq:2.0}
  ];
  // остекление кабины: верхне-передний сектор между носом и центропланом
  // фонарь кабины — верхняя передняя часть лофта, плюс нижние «подбородочные» окна
  const hull = loft(secs, 48, (i, th)=> (i>=1 && i<=3 && th > 0.18 && th < Math.PI-0.18) || (i===4 && th > 0.75 && th < Math.PI-0.75)
                                    || (i>=1 && i<=2 && th > Math.PI*1.08 && th < Math.PI*1.32) || (i>=1 && i<=2 && th > Math.PI*1.68 && th < Math.PI*1.92));
  const fus = new THREE.Mesh(hull, [olive, glassM]); G.add(fus);
  // переплёт фонаря
  for(const zz of [-0.02, 0.02]){
    const f = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.05, 0.05), black);
    f.position.set(2.62, 2.18, zz); f.rotation.z = -0.62; G.add(f);
  }
  for(const s of [-1,1]){
    // сдвижные двери десантной кабины с окнами
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.25, 0.03), olive);
    door.position.set(0.05, 1.42, s*1.165); G.add(door);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.48), glassM);
    win.position.set(0.2, 1.75, s*1.185); win.rotation.y = s>0 ? 0 : Math.PI; G.add(win);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 0.05), metal);
    rail.position.set(-0.3, 2.1, s*1.17); G.add(rail);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), M.chrome);
    handle.position.set(0.72, 1.35, s*1.2); G.add(handle);
    // дверь пилота с блистером
    const pd = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.62), glassM);
    pd.position.set(1.72, 1.78, s*1.16); pd.rotation.y = s>0 ? 0.05 : Math.PI-0.05; G.add(pd);
    const pf = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.04, 0.04), black); pf.position.set(1.72, 1.47, s*1.17); G.add(pf);
    // навигационные огни: красный слева, зелёный справа
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshStandardMaterial({color: s<0?0x8a1c16:0x1f7a36, emissive: s<0?0x8a1c16:0x1f7a36, emissiveIntensity:1.4}));
    nav.position.set(-4.9, 2.02, s*0.95); G.add(nav);
    // горизонтальный стабилизатор
    const st = new THREE.Mesh(roundedBox(0.62, 0.06, 1.1, 0.03, 2), olive);
    st.position.set(-4.9, 1.98, s*0.62); G.add(st);
    // полозья: труба с загнутым носком и ступенькой
    const pts = [V(-1.9,0.08,s*1.25), V(1.4,0.08,s*1.25), V(1.9,0.13,s*1.25), V(2.15,0.32,s*1.25)];
    const skid = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.045, 8), metal); G.add(skid);
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.18), black); step.position.set(0.9, 0.42, s*1.22); G.add(step);
  }
  // дуги шасси
  for(const xx of [1.15, -1.05]){
    const arc = new THREE.CatmullRomCurve3([V(xx,0.08,-1.25), V(xx,0.62,-1.05), V(xx,0.72,0), V(xx,0.62,1.05), V(xx,0.08,1.25)]);
    G.add(new THREE.Mesh(new THREE.TubeGeometry(arc, 24, 0.05, 8), metal));
  }
  // капот двигателя, воздухозаборник, выхлоп
  const cowl = new THREE.Mesh(roundedBox(2.3, 0.62, 1.0, 0.22, 4), olive); cowl.position.set(-0.55, 2.62, 0); G.add(cowl);
  const intake = new THREE.Mesh(roundedBox(0.4, 0.42, 0.9, 0.14, 3), oliveDark); intake.position.set(0.72, 2.58, 0); G.add(intake);
  for(let i=0;i<6;i++){ const gr = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.78), black); gr.position.set(0.93, 2.58, 0); gr.position.y = 2.45 + i*0.05; G.add(gr); }
  const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.55, 14, 1, true), new THREE.MeshStandardMaterial({color:0x2b2622, roughness:.5, metalness:.8, side:THREE.DoubleSide}));
  exh.rotation.z = Math.PI/2 - 0.25; exh.position.set(-1.88, 2.72, 0); G.add(exh);
  // киль, рулевой винт
  const finShape = new THREE.Shape([new THREE.Vector2(0,0), new THREE.Vector2(0.9,0), new THREE.Vector2(0.5,1.35), new THREE.Vector2(-0.05,1.35)]);
  const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, {depth:0.1, bevelEnabled:true, bevelSize:0.02, bevelThickness:0.02, bevelSegments:1}), olive);
  fin.position.set(-8.3, 2.12, -0.05); G.add(fin);
  const trHub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.22, 10), metal);
  trHub.rotation.x = Math.PI/2; trHub.position.set(-7.75, 3.1, -0.2); G.add(trHub);
  for(let i=0;i<2;i++){ const b = new THREE.Mesh(roundedBox(0.14, 1.5, 0.02, 0.01, 1), black);
    b.position.set(-7.75, 3.1, -0.3); b.rotation.z = i*Math.PI/2 + 0.5; G.add(b); }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8, 0, Math.PI*2, 0, Math.PI/2),
    new THREE.MeshStandardMaterial({color:0x9a1c14, emissive:0xb01c10, emissiveIntensity:0.8, transparent:true, opacity:0.9}));
  beacon.position.set(-2.0, 2.42, 0); G.add(beacon);
  // мачта, втулка, штанга стабилизатора, лопасти с провисом
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.7, 12), M.chrome); mast.position.set(0.1, 3.2, 0); G.add(mast);
  const hub = new THREE.Mesh(roundedBox(0.7, 0.18, 0.34, 0.06, 2), metal); hub.position.set(0.1, 3.58, 0); G.add(hub);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.9, 6), metal); bar.rotation.x = Math.PI/2; bar.position.set(0.1, 3.72, 0); G.add(bar);
  for(const s of [-1,1]){ const w = new THREE.Mesh(new THREE.SphereGeometry(0.07,8,6), metal); w.position.set(0.1, 3.72, s*0.95); w.scale.set(1.6,0.7,1); G.add(w); }
  const ROT = 7.2, bladeAng = 0.42;
  for(let i=0;i<2;i++){
    const a = bladeAng + i*Math.PI;
    const blade = new THREE.Group();
    const seg = 6;
    for(let k=0;k<seg;k++){
      const L = ROT/seg, piece = new THREE.Mesh(roundedBox(L+0.02, 0.05, 0.53, 0.02, 1), black);
      const r0 = 0.35 + k*L, droop = -0.012*Math.pow((r0+L/2), 1.6);
      piece.position.set(r0 + L/2, droop, 0); piece.rotation.z = -0.018*Math.pow(r0+L/2, 0.6); blade.add(piece);
    }
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.052, 0.54), cmat(0xc9c2a0,{roughness:.6}));
    tip.position.set(ROT+0.25, -0.012*Math.pow(ROT+0.25,1.6), 0); blade.add(tip);
    blade.position.set(0.1, 3.6, 0); blade.rotation.y = -a; G.add(blade);
  }
  // швартовка лопасти к хвостовой балке: трос и чехол
  const tipW = V(0.1 + Math.cos(Math.PI+bladeAng)*6.8, 3.0, -Math.sin(Math.PI+bladeAng)*6.8);
  const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([tipW, V(tipW.x+0.2, 2.6, tipW.z*0.6), V(-6.0, 2.15, 0.25)]), 16, 0.01, 4), cmat(0xb7a476,{roughness:.9}));
  G.add(rope);
  // бортовой номер и опознавательные полосы
  const numC = document.createElement('canvas'); numC.width = 256; numC.height = 96;
  const nx = numC.getContext('2d'); nx.fillStyle = 'rgba(0,0,0,0)'; nx.fillRect(0,0,256,96);
  nx.font = '700 72px "Segoe UI",Arial'; nx.fillStyle = '#d8d6c8'; nx.textAlign='center'; nx.textBaseline='middle'; nx.fillText('141', 128, 50);
  const numT = new THREE.CanvasTexture(numC); numT.colorSpace = THREE.SRGBColorSpace;
  const numM = new THREE.MeshStandardMaterial({map:numT, transparent:true, roughness:.8, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2});
  for(const s of [-1,1]){ const n = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), numM);
    n.position.set(-3.9, 2.02, s*0.41); n.rotation.y = s>0 ? 0 : Math.PI; n.rotation.x = 0; G.add(n); }
  // красные ленты «REMOVE BEFORE FLIGHT» на заглушках
  const tag = cmat(0xa8241a,{roughness:.9, side:THREE.DoubleSide});
  for(const [px,py,pz] of [[-1.95,2.6,0.25]]){ const t = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.35), tag);
    t.position.set(px, py-0.18, pz); t.rotation.z = 0.2; G.add(t); }
  G.position.set(x, y, z); G.rotation.y = rotY;
  shadowAll(G);
  G.userData.nomerge = true;
  scene.add(G);
  // коллайдеры: кабина, хвостовая балка, лыжи
  const q = new THREE.Quaternion().setFromAxisAngle(V(0,1,0), rotY);
  const W = (lx,ly,lz)=> V(lx,ly,lz).applyQuaternion(q).add(V(x,y,z));
  let c = W(0.6, 1.3, 0); addOBB(c.x,c.y,c.z, 5.4, 1.9, 2.3, q, 'metal');
  c = W(-0.5, 2.6, 0); addOBB(c.x,c.y,c.z, 2.4, 0.7, 1.0, q, 'metal');
  c = W(-5.2, 2.05, 0); addOBB(c.x,c.y,c.z, 6.0, 0.5, 0.5, q, 'metal');
  c = W(-8.0, 2.8, 0); addOBB(c.x,c.y,c.z, 0.9, 1.4, 0.2, q, 'metal');
  return G;
}

/* ============================================================================
   ГАБИОН HESCO: проволочная сетка + мешок с песком. Держит пули.
============================================================================ */
export function hesco(x, z, rotY, n=3, h=1.35, y=0){
  const cell = 1.05;
  const L = n*cell;
  const G = new THREE.Group();
  for(let i=0;i<n;i++){
    const off = (i-(n-1)/2)*cell;
    const sand = new THREE.Mesh(roundedBox(cell-0.04, h-0.04, cell-0.04, 0.1, 2), M.hesco);
    sand.position.set(off, h/2, 0); sand.scale.set(1, 1, 1); G.add(sand);
    // верх: насыпь горбом
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI*2, 0, Math.PI/2), M.sand);
    top.scale.set(1.0, 0.18, 1.0); top.position.set(off, h-0.03, 0); G.add(top);
    // сетка чуть больше мешка — просвечивает ткань
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(cell, h, cell), M.hescoMesh);
    const uv = mesh.geometry.attributes.uv; for(let k=0;k<uv.count;k++) uv.setXY(k, uv.getX(k)*2.2, uv.getY(k)*2.8);
    mesh.position.set(off, h/2, 0); G.add(mesh);
    for(const sx of [-1,1]) for(const sz of [-1,1]){
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, h, 0.03), M.steel);
      post.position.set(off + sx*cell/2, h/2, sz*cell/2); G.add(post);
    }
  }
  G.position.set(x, y, z); G.rotation.y = rotY; shadowAll(G);
  scene.add(G);
  addAABB(x, y+h/2, z, L, h, cell, rotY, 'sand');
  return G;
}
/** Мешки с песком: уложенные вперевязку «кирпичи» с продавленной серединой. */
export function sandbagWall(x, z, rotY, len=3.0, rows=4, y=0){
  const G = new THREE.Group();
  // мешок: скруглённая подушка, прошитая по краям, чуть просевшая под весом
  const bag = roundedBox(0.6, 0.16, 0.34, 0.065, 3);
  { const pa = bag.attributes.position; for(let i=0;i<pa.count;i++){ const x = pa.getX(i), z = pa.getZ(i), y = pa.getY(i);
      const k = 1 - Math.pow(Math.abs(x)/0.3, 4)*0.35; pa.setY(i, y*k); pa.setZ(i, z*(1 - Math.pow(Math.abs(x)/0.3, 6)*0.25)); }
    bag.computeVertexNormals(); }
  const per = Math.max(2, Math.round(len/0.58));
  for(let r=0;r<rows;r++){
    for(let i=0;i<per - (r%2); i++){
      const off = (i - (per-1-(r%2))/2)*0.58;
      for(const dz of [-0.17, 0.17]){
        const m = new THREE.Mesh(bag, M.sandbag);
        m.position.set(off + rnd(-0.02,0.02), 0.075 + r*0.145, dz + rnd(-0.02,0.02));
        m.rotation.y = rnd(-0.06,0.06); m.rotation.z = rnd(-0.04,0.04);
        G.add(m);
      }
    }
  }
  G.position.set(x, y, z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  addAABB(x, y + rows*0.145/2, z, per*0.58, rows*0.145, 0.7, rotY, 'sand');
  return G;
}

/* ============================================================================
   ЛОМКИЙ РЕКВИЗИТ
============================================================================ */
const plank = (G, mat, w,h,d, x,y,z, rx=0,ry=0,rz=0)=>{
  const g = new THREE.BoxGeometry(w,h,d); uvBox(g,w,h,d,1.1,true);
  const m = new THREE.Mesh(g, mat); m.position.set(x,y,z); m.rotation.set(rx,ry,rz); G.add(m); return m;
};
/** Деревянный ящик из досок: при поломке разлетается на доски. */
export function crate(x, y, z, rotY, s=0.9){
  const G = new THREE.Group();
  const mat = M.woodDark, n = 4, bw = s/n;
  for(const side of [-1,1]){
    for(let i=0;i<n;i++){
      plank(G, mat, s, bw-0.01, 0.022, 0, bw*(i+0.5), side*(s/2-0.011));
      plank(G, mat, 0.022, bw-0.01, s-0.044, side*(s/2-0.011), bw*(i+0.5), 0);
    }
  }
  for(let i=0;i<n;i++) plank(G, mat, s-0.044, 0.022, bw-0.01, 0, s-0.011, -s/2+bw*(i+0.5));
  for(const sx of [-1,1]) for(const sz of [-1,1]) plank(G, M.wood, 0.05, s, 0.05, sx*(s/2-0.035), s/2, sz*(s/2-0.035));
  for(const side of [-1,1]) plank(G, M.wood, s*1.3, 0.07, 0.024, 0, s/2, side*(s/2+0.012), 0, 0, Math.atan2(s*0.9, s)*0.9);
  G.position.set(x,y,z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  return registerProp(G, {hp:130, mass:25, col:{cx:x, cy:y+s/2, cz:z, hx:s/2, hy:s/2, hz:s/2, q:qY(rotY)}});
}
const qY = r => { const q = new THREE.Quaternion().setFromAxisAngle(V(0,1,0), r); return [q.x,q.y,q.z,q.w]; };
/** Штабель поддонов. */
export function palletStack(x, y, z, rotY, n=5){
  const G = new THREE.Group();
  for(let k=0;k<n;k++){
    const yy = k*0.144 + rnd(-0.005,0.005), ry = rnd(-0.05,0.05);
    const P = new THREE.Group(); P.position.y = yy; P.rotation.y = ry;
    for(let i=0;i<7;i++) plank(P, M.wood, 0.1, 0.022, 0.8, -0.55+i*0.183, 0.133, 0);
    for(const o of [-0.34,0,0.34]) plank(P, M.woodDark, 1.2, 0.09, 0.1, 0, 0.078, o);
    for(let i=0;i<3;i++) plank(P, M.wood, 0.1, 0.022, 0.8, -0.5+i*0.5, 0.011, 0);
    G.add(P);
  }
  G.position.set(x,y,z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  return registerProp(G, {hp:160, mass:18*n, col:{cx:x, cy:y+n*0.072, cz:z, hx:0.6, hy:n*0.072, hz:0.42, q:qY(rotY)}});
}
/** Баррикада из щитов фанеры на козлах: укрытие, которое простреливается и горит. */
export function barricade(x, y, z, rotY, w=2.4, h=1.15){
  const G = new THREE.Group();
  const panels = Math.max(1, Math.round(w/1.2));
  for(let i=0;i<panels;i++){
    const off = (i-(panels-1)/2)*(w/panels);
    plank(G, M.plywood, w/panels-0.02, h, 0.018, off, h/2+0.05, 0, 0, 0, rnd(-0.015,0.015));
  }
  for(const s of [-1,1]){
    plank(G, M.wood, 0.07, h+0.1, 0.07, s*(w/2-0.1), (h+0.1)/2, -0.05);
    plank(G, M.wood, 0.06, 0.06, 0.7, s*(w/2-0.1), 0.35, -0.3, 0.9, 0, 0);
  }
  plank(G, M.wood, w, 0.08, 0.04, 0, h*0.7, -0.05);
  G.position.set(x,y,z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  return registerProp(G, {hp:180, mass:40, col:{cx:x, cy:y+h/2+0.05, cz:z, hx:w/2, hy:h/2+0.05, hz:0.12, q:qY(rotY)}});
}
/** Мишень IPSC на кольях: фанерный силуэт с зонами. */
let _tgtTex = null;
function targetTex(){
  if(_tgtTex) return _tgtTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 400; const x = c.getContext('2d');
  x.fillStyle = '#b89a6a'; x.fillRect(0,0,256,400);
  for(let i=0;i<600;i++){ x.fillStyle = `rgba(${90+Math.random()*60|0},${70+Math.random()*40|0},${40+Math.random()*30|0},${Math.random()*0.12})`; x.fillRect(Math.random()*256, Math.random()*400, 2+Math.random()*30, 1+Math.random()*3); }
  x.strokeStyle = 'rgba(60,40,20,.55)'; x.lineWidth = 3;
  x.beginPath(); x.ellipse(128, 60, 40, 48, 0, 0, 7); x.stroke();
  x.strokeRect(78, 150, 100, 150); x.strokeRect(98, 170, 60, 70);
  x.beginPath(); x.moveTo(20,400); x.lineTo(20,160); x.lineTo(60,120); x.lineTo(196,120); x.lineTo(236,160); x.lineTo(236,400); x.stroke();
  x.fillStyle='rgba(60,40,20,.7)'; x.font='700 22px Arial'; x.fillText('A', 120, 210);
  _tgtTex = new THREE.CanvasTexture(c); _tgtTex.colorSpace = THREE.SRGBColorSpace;
  return _tgtTex;
}
export function target(x, y, z, rotY){
  const G = new THREE.Group();
  const sh = new THREE.Shape();
  sh.moveTo(-0.23,0); sh.lineTo(0.23,0); sh.lineTo(0.23,0.44); sh.lineTo(0.16,0.52); sh.lineTo(0.07,0.52); sh.lineTo(0.07,0.6);
  sh.quadraticCurveTo(0.1,0.74,0,0.76); sh.quadraticCurveTo(-0.1,0.74,-0.07,0.6); sh.lineTo(-0.07,0.52); sh.lineTo(-0.16,0.52); sh.lineTo(-0.23,0.44); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, {depth:0.012, bevelEnabled:false});
  const uv = g.attributes.uv; for(let i=0;i<uv.count;i++) uv.setXY(i, (uv.getX(i)+0.23)/0.46, uv.getY(i)/0.76);
  const face = new THREE.Mesh(g, new THREE.MeshStandardMaterial({map:targetTex(), roughness:.95}));
  face.position.set(0, 0.95, 0); G.add(face);
  for(const s of [-1,1]) plank(G, M.wood, 0.035, 1.05, 0.02, s*0.14, 0.52, -0.02, 0, 0, s*0.03);
  plank(G, M.woodDark, 0.5, 0.05, 0.3, 0, 0.025, -0.02);
  G.position.set(x,y,z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  return registerProp(G, {hp:90, mass:4, col:{cx:x, cy:y+1.1, cz:z, hx:0.24, hy:0.55, hz:0.05, q:qY(rotY)}});
}
/** Стол на козлах (можно перевернуть как укрытие — стоит на боку). */
export function table(x, y, z, rotY, flipped=false){
  const G = new THREE.Group();
  if(!flipped){
    plank(G, M.plywood, 1.8, 0.03, 0.8, 0, 0.76, 0);
    for(const s of [-1,1]){ plank(G, M.wood, 0.06, 0.74, 0.06, s*0.8, 0.37, 0.32); plank(G, M.wood, 0.06, 0.74, 0.06, s*0.8, 0.37, -0.32); plank(G, M.wood, 0.05, 0.05, 0.7, s*0.8, 0.2, 0); }
  } else {
    plank(G, M.plywood, 1.8, 0.8, 0.03, 0, 0.4, 0);
    for(const s of [-1,1]){ plank(G, M.wood, 0.06, 0.06, 0.74, s*0.8, 0.72, -0.37); plank(G, M.wood, 0.06, 0.06, 0.74, s*0.8, 0.08, -0.37); }
  }
  G.position.set(x,y,z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  return registerProp(G, {hp:110, mass:22, col:{cx:x, cy:y+0.4, cz:z, hx:0.9, hy:0.4, hz: flipped?0.05:0.4, q:qY(rotY)}});
}
/** Бочка с топливом: простреленная — течёт и загорается, горящая — взрывается. */
export function fuelBarrel(x, y, z, rotY=0, col=0x8d2a1c){
  const G = new THREE.Group();
  const mat = cmat(col, {roughness:.55, metalness:.4});
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 20), mat); body.position.y = 0.44; G.add(body);
  for(const yy of [0.22, 0.44, 0.66]){ const r = new THREE.Mesh(new THREE.TorusGeometry(0.295, 0.018, 6, 20), mat); r.rotation.x = Math.PI/2; r.position.y = yy; G.add(r); }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 20), M.dark); lid.position.y = 0.885; G.add(lid);
  // знак огнеопасно
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const xx = c.getContext('2d');
  xx.fillStyle='#d8b030'; xx.beginPath(); xx.moveTo(32,4); xx.lineTo(60,56); xx.lineTo(4,56); xx.closePath(); xx.fill();
  xx.fillStyle='#111'; xx.font='700 30px Arial'; xx.textAlign='center'; xx.fillText('!', 32, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.2,0.2), new THREE.MeshStandardMaterial({map:t, transparent:true, roughness:.7}));
  sign.position.set(0, 0.5, 0.295); G.add(sign);
  G.position.set(x,y,z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  return registerProp(G, {hp:120, mass:60, wood:false, surf:'metal', explosive:true, burnHp:1.6,
    col:{cx:x, cy:y+0.44, cz:z, hx:0.3, hy:0.44, hz:0.3, q:null}});
}

/* ============================================================================
   ДИНАМИЧЕСКИЙ РЕКВИЗИТ: катится, падает, разлетается от взрыва.
============================================================================ */
export function dynBarrel(x, y, z, col=0x4e5a46, tipped=false){
  const mat = cmat(col, {roughness:.6, metalness:.35});
  const parts = [new THREE.CylinderGeometry(0.29,0.29,0.88,18)];
  for(const yy of [-0.22,0,0.22]){ const r = new THREE.TorusGeometry(0.295,0.018,5,18); r.rotateX(Math.PI/2); r.translate(0,yy,0); parts.push(r); }
  const g = mergeParts(parts);
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true;
  m.position.set(x, y + (tipped?0.3:0.44), z);
  if(tipped){ m.rotation.z = Math.PI/2; m.rotation.y = rnd(0,6.28); }
  m.userData.nomerge = true; scene.add(m);
  DYN_PROPS.push({mesh:m, shape:'cyl', size:[0.58,0.88,0.58], mass:22, surf:'metal', friction:0.6, restitution:0.2});
}
export function dynCone(x, y, z){
  const parts = [new THREE.ConeGeometry(0.17,0.55,14)]; parts[0].translate(0,0.3,0);
  const b = new THREE.BoxGeometry(0.34,0.035,0.34); b.translate(0,0.018,0); parts.push(b);
  const g = mergeParts(parts); g.translate(0,-0.28,0);
  const m = new THREE.Mesh(g, M.plastO); m.castShadow = true; m.position.set(x, y+0.28, z); m.userData.nomerge = true; scene.add(m);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.105,0.125,0.08,14), cmat(0xe8e4d8,{roughness:.5})); band.position.y = 0.05; m.add(band);
  DYN_PROPS.push({mesh:m, shape:'box', size:[0.3,0.56,0.3], mass:2, surf:'sand', friction:0.8});
}
export function dynTire(x, y, z){
  const g = new THREE.TorusGeometry(0.36,0.135,9,18);
  const m = new THREE.Mesh(g, M.rubber); m.castShadow = true; m.rotation.x = Math.PI/2; m.position.set(x, y+0.14, z);
  m.userData.nomerge = true; scene.add(m);
  DYN_PROPS.push({mesh:m, shape:'box', size:[0.98,0.98,0.27], mass:9, surf:'sand', friction:0.9, restitution:0.35});
}
export function dynBox(x, y, z, rotY, s=[0.5,0.35,0.4], mat){
  const g = new THREE.BoxGeometry(...s); uvBox(g, s[0], s[1], s[2], 1.2);
  const m = new THREE.Mesh(g, mat || M.foam); m.castShadow = m.receiveShadow = true;
  m.position.set(x, y + s[1]/2, z); m.rotation.y = rotY; m.userData.nomerge = true; scene.add(m);
  DYN_PROPS.push({mesh:m, shape:'box', size:s, mass: s[0]*s[1]*s[2]*300, surf:'wood'});
}
function mergeParts(parts){
  for(const p of parts){ for(const k of Object.keys(p.attributes)) if(!['position','normal','uv'].includes(k)) p.deleteAttribute(k); }
  const idx = parts.every(p=>p.index);
  return BGU.mergeGeometries(idx ? parts : parts.map(p=>p.index?p.toNonIndexed():p), false);
}
