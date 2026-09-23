// Реквизит, техника, вертолётная площадка, модульные укрытия (статичная часть).
import { THREE, scene, Q, sr, srnd, si, spick, clamp, lerp } from './engine.js';
import { M, cmat } from './materials.js';
import { addBox, addAABB, addOBB, bucket, uvBox, tintGeo, COLLIDERS, SHOOTABLE, _m4, _q, _e, roundedBox, beamBetween } from './builder.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
/** Реквизит ставится вручную с явной отметкой опоры. */
function snapSupport(x, z, y){ return y; }
let HELI_HOOK = ()=>{};
export function setHeliHook(f){ HELI_HOOK = f; }
function meshAt(geo, mat, x,y,z, opt={}){
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x,y,z);
  if(opt.rotY) m.rotation.y = opt.rotY;
  if(opt.rotX) m.rotation.x = opt.rotX;
  if(opt.rotZ) m.rotation.z = opt.rotZ;
  m.castShadow = opt.cast !== false; m.receiveShadow = true;
  scene.add(m); SHOOTABLE.push(m);
  return m;
}
/* --- бочка 200 л с рёбрами --- */
const barrelGeoCache = {};
function barrel(x,y,z,col,tipped){
  y = snapSupport(x,z,y); if(y === null) return;
  const key = 'b'; 
  if(!barrelGeoCache[key]){
    const parts = [];
    const body = new THREE.CylinderGeometry(0.295,0.295,0.88,20,1);
    parts.push(body);
    for(const yy of [-0.22,0.0,0.22]){
      const r = new THREE.TorusGeometry(0.30,0.022,6,20); r.rotateX(Math.PI/2); r.translate(0,yy,0);
      parts.push(r);
    }
    const lid = new THREE.CylinderGeometry(0.30,0.30,0.035,20); lid.translate(0,0.45,0);
    parts.push(lid);
    barrelGeoCache[key] = BGU.mergeGeometries(parts,false);
  }
  const mat = col==='green' ? M.paintG : col==='blue' ? M.plastB : col==='orange' ? M.plastO : M.steel;
  const m = meshAt(barrelGeoCache[key], mat, x, y+(tipped?0.30:0.44), z, {rotY:sr(0,6.28)});
  if(tipped){ m.rotation.z = Math.PI/2; m.rotation.y = sr(0,6.28);
    COLLIDERS.push({x0:x-0.46,y0:y,z0:z-0.46,x1:x+0.46,y1:y+0.6,z1:z+0.46}); }
  else COLLIDERS.push({x0:x-0.31,y0:y,z0:z-0.31,x1:x+0.31,y1:y+0.9,z1:z+0.31});
  return m;
}
/* --- покрышка --- */
let tireGeo;
function tire(x,y,z,stand){
  y = snapSupport(x,z,y); if(y === null) return;
  if(!tireGeo) tireGeo = new THREE.TorusGeometry(0.36,0.135,9,18);
  const m = meshAt(tireGeo, M.rubber, x, y+(stand?0.36:0.135), z,
                   {rotX: stand?0:Math.PI/2, rotY:sr(0,3)});
  COLLIDERS.push({x0:x-0.48,y0:y,z0:z-0.48,x1:x+0.48,y1:y+(stand?0.72:0.28),z1:z+0.48});
}
/* --- поддон --- */
function pallet(x,y,z,rotY,n=1){
  y = snapSupport(x,z,y); if(y === null) return;
  for(let k=0;k<n;k++){
    const yy = y + k*0.145;
    for(let i=0;i<7;i++)
      addBox('wood', x + Math.cos(rotY)*(-0.55+i*0.183), yy+0.125, z - Math.sin(rotY)*(-0.55+i*0.183),
             0.09, 0.022, 0.8, {rotY, collide:false, d:1.1});
    for(const o of [-0.34,0,0.34])
      addBox('wood', x - Math.sin(rotY)*o, yy+0.055, z - Math.cos(rotY)*o,
             1.2, 0.09, 0.1, {rotY, collide:false, d:1.1});
    for(let i=0;i<4;i++)
      addBox('wood', x + Math.cos(rotY)*(-0.5+i*0.33), yy+0.018, z - Math.sin(rotY)*(-0.5+i*0.33),
             0.1, 0.036, 0.8, {rotY, collide:false, d:1.1});
  }
  addAABB(x, y+n*0.145/2, z, 1.26, n*0.145+0.05, 0.86, rotY);
}
/* --- кабельная катушка --- */
function spool(x,y,z){
  y = snapSupport(x,z,y); if(y === null) return;
  const parts=[];
  for(const s of [-1,1]){
    const d = new THREE.CylinderGeometry(0.66,0.66,0.075,22); d.rotateX(Math.PI/2); d.translate(0,0.66,s*0.32);
    parts.push(d);
    for(let i=0;i<8;i++){   // радиальные рёбра щёк
      const r = new THREE.BoxGeometry(0.08,1.2,0.03);
      r.rotateZ(i*Math.PI/8); r.translate(0,0.66,s*0.36);
      parts.push(r);
    }
  }
  const core = new THREE.CylinderGeometry(0.33,0.33,0.62,18); core.rotateX(Math.PI/2); core.translate(0,0.66,0);
  parts.push(core);
  const m = meshAt(BGU.mergeGeometries(parts,false), M.wood, x, y, z, {rotY:sr(0,6.28)});
  // намотанный кабель
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.47,0.47,0.56,20), M.cable);
  cab.rotation.x = Math.PI/2; cab.position.set(x, y+0.66, z);
  cab.castShadow = true; scene.add(cab);
  COLLIDERS.push({x0:x-0.66,y0:y,z0:z-0.66,x1:x+0.66,y1:y+1.32,z1:z+0.66});
}
/* --- конус --- */
let coneGeo;
function cone(x,y,z){
  y = snapSupport(x,z,y); if(y === null) return;
  if(!coneGeo){
    const parts=[new THREE.ConeGeometry(0.175,0.55,14)];
    parts[0].translate(0,0.30,0);
    const b = new THREE.BoxGeometry(0.34,0.035,0.34); b.translate(0,0.018,0); parts.push(b);
    coneGeo = BGU.mergeGeometries(parts,false);
  }
  meshAt(coneGeo, M.plastO, x,y,z, {rotY:sr(0,6.28)});
  // светоотражающая полоса
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.115,0.135,0.08,14),
    cmat(0xe8e4d8,{roughness:.5}));
  band.position.set(x,y+0.33,z); scene.add(band);
}
/* --- штабель бруса --- */
function lumberPile(x,y,z,rotY,len=3.4,rows=7){
  y = snapSupport(x,z,y); if(y === null) return;
  for(let i=0;i<rows;i++)
    for(let j=0;j<3;j++)
      addBox('wood', x - Math.sin(rotY)*(-0.2+j*0.2), y+0.05+i*0.082, z - Math.cos(rotY)*(-0.2+j*0.2),
             len, 0.075, 0.17, {rotY, collide:false, d:1.2});
  addAABB(x, y+rows*0.082/2, z, len, rows*0.082+0.06, 0.66, rotY);
}
/* --- пачка листов OSB --- */
function osbStack(x,y,z,rotY,n=8){
  y = snapSupport(x,z,y); if(y === null) return;
  for(let i=0;i<n;i++)
    addBox(i%2?'osb':'osb2', x, y+0.02+i*0.0135, z, 2.5, 0.0125, 1.25, {rotY, collide:false, d:.85});
  addAABB(x, y+n*0.0135/2, z, 2.5, n*0.0135+0.05, 1.25, rotY);
}
/* --- прислонённые листы --- */
function leanSheet(x,y,z,rotY,tilt){
  y = snapSupport(x,z,y); if(y === null) return;
  const g = new THREE.BoxGeometry(1.25,2.5,0.0125); uvBox(g,1.25,2.5,0.0125,.85);
  const m = new THREE.Mesh(g, srnd()<0.5?M.osb:M.osb2);
  m.position.set(x, y+1.24*Math.cos(tilt), z);
  m.rotation.set(0,rotY,0); m.rotateX(tilt);
  m.castShadow = m.receiveShadow = true; scene.add(m); SHOOTABLE.push(m);
  COLLIDERS.push({x0:x-0.72,y0:y,z0:z-0.72,x1:x+0.72,y1:y+2.3,z1:z+0.72});
}
/* --- строительные козлы --- */
function sawhorse(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  addBox('wood', x, y+0.74, z, 1.5, 0.09, 0.12, {rotY, d:1.1});
  for(const sx of [-0.6,0.6]) for(const sz of [-0.28,0.28]){
    const px = x + Math.cos(rotY)*sx - Math.sin(rotY)*sz;
    const pz = z - Math.sin(rotY)*sx - Math.cos(rotY)*sz;
    addBox('wood', px, y+0.37, pz, 0.07, 0.74, 0.07, {collide:false, d:1});
  }
}
/* --- стремянка --- */
function ladder(x,y,z,rotY,h=2.4){
  y = snapSupport(x,z,y); if(y === null) return;
  const n = Math.floor(h/0.32);
  for(let i=1;i<=n;i++)
    addBox('wood', x, y+i*0.32, z, 0.46, 0.045, 0.045, {rotY, collide:false, d:1});
  for(const s of [-0.24,0.24]){
    const px = x + Math.cos(rotY)*s, pz = z - Math.sin(rotY)*s;
    addBox('wood', px, y+h/2, pz, 0.055, h, 0.055, {collide:false, d:1});
  }
  addAABB(x, y+h/2, z, 0.56, h, 0.2, rotY);
}
/* --- мешки / ведра / коробки --- */
function bags(x,y,z,n=4){
  y = snapSupport(x,z,y); if(y === null) return;
  for(let i=0;i<n;i++){
    const g = new THREE.BoxGeometry(sr(0.5,0.68), sr(0.16,0.22), sr(0.34,0.44));
    const m = new THREE.Mesh(g, M.foam);
    m.position.set(x+sr(-0.1,0.1), y+0.1+i*0.19, z+sr(-0.1,0.1));
    m.rotation.y = sr(0,6.28); m.rotation.z = sr(-0.05,0.05);
    m.castShadow = m.receiveShadow = true; scene.add(m); SHOOTABLE.push(m);
  }
  COLLIDERS.push({x0:x-0.4,y0:y,z0:z-0.3,x1:x+0.4,y1:y+n*0.19,z1:z+0.3});
}
function paintBucket(x,y,z,col){
  y = snapSupport(x,z,y); if(y === null) return;
  const g = new THREE.CylinderGeometry(0.15,0.12,0.32,14);
  meshAt(g, col||M.plastO, x, y+0.16, z, {rotY:sr(0,6.28)});
}
function crate(x,y,z,rotY,s=0.7){
  y = snapSupport(x,z,y); if(y === null) return;
  addBox('wood', x,y+s/2,z, s,s,s*0.8, {rotY, d:1.1});
  for(const o of [-s/2+0.03, s/2-0.03])
    addBox('wood', x + Math.cos(rotY)*o, y+s/2, z - Math.sin(rotY)*o, 0.05,s,s*0.82, {rotY, collide:false, d:1.1});
}
/* --- бетонный блок / отбойник --- */
function jerseyBarrier(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  addBox('panel', x, y+0.18, z, 2.2, 0.36, 0.62, {rotY, d:.5});
  addBox('panel', x, y+0.62, z, 2.2, 0.55, 0.36, {rotY, d:.5});
}
/* --- мешки с песком (укрытие) --- */
function sandbags(x,y,z,rotY,rows=3,len=4){
  y = snapSupport(x,z,y); if(y === null) return;
  for(let r=0;r<rows;r++){
    const n = len - r;
    for(let i=0;i<n;i++){
      const off = (i-(n-1)/2)*0.42 + (r%2?0.2:0);
      const px = x + Math.cos(rotY)*off, pz = z - Math.sin(rotY)*off;
      const g = new THREE.SphereGeometry(0.24, 8, 6);
      g.scale(1.0, 0.62, 0.72);
      const m = new THREE.Mesh(g, M.tarp);
      m.position.set(px, y+0.14+r*0.26, pz);
      m.rotation.y = rotY + sr(-0.12,0.12);
      m.castShadow = m.receiveShadow = true; scene.add(m);
    }
  }
  addAABB(x, y+rows*0.26/2, z, len*0.42, rows*0.26, 0.5, rotY);
}


/* ---------- Инструментальная тележка ---------- */
function toolCart(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  const body = new THREE.Mesh(roundedBox(0.78,0.86,0.48,0.05,2), M.plastB);
  body.position.y = 0.62; G.add(body);
  // ящики: три выдвинутых на разную глубину
  for(let i=0;i<3;i++){
    const out = i===1 ? 0.14 : (i===2 ? 0.05 : 0);
    const dr = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.21, 0.44+out*2), M.dark);
    dr.position.set(0, 0.34+i*0.26, out); G.add(dr);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.30,0.03,0.035), M.chrome);
    h.position.set(0, 0.34+i*0.26, 0.24+out); G.add(h);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.84,0.04,0.54), M.steel);
  top.position.y = 1.07; G.add(top);
  // инструмент на крышке
  const wr = new THREE.Mesh(new THREE.BoxGeometry(0.26,0.02,0.05), M.chrome);
  wr.position.set(0.14,1.10,-0.10); wr.rotation.y = 0.4; G.add(wr);
  const box2 = new THREE.Mesh(roundedBox(0.34,0.16,0.2,0.03,2), M.plastO);
  box2.position.set(-0.18,1.17,0.06); box2.rotation.y = -0.3; G.add(box2);
  for(const sx of [-0.3,0.3]) for(const sz of [-0.18,0.18]){
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.075,0.032,6,10), M.rubber);
    w.position.set(sx,0.08,sz); w.rotation.y = Math.PI/2; G.add(w);
  }
  G.position.set(x,y,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(G); SHOOTABLE.push(G);
  addAABB(x, y+0.55, z, 0.9, 1.1, 0.6, rotY);
}
/* ---------- Газовые баллоны в клети ---------- */
function gasBottles(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const cols = [0x3e5f43, 0x8d3b2c, 0x2f4a68, 0x8a8b86];
  for(let i=0;i<4;i++){
    const off = (i-1.5)*0.31;
    const px = x + Math.cos(rotY)*off, pz = z - Math.sin(rotY)*off;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.115,0.115,1.14,12),
      cmat(cols[i%cols.length],{roughness:.55, metalness:.32}));
    b.position.set(px, y+0.62, pz); b.castShadow = b.receiveShadow = true;
    scene.add(b);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075,0.095,0.16,10), M.dark);
    cap.position.set(px, y+1.26, pz); cap.castShadow = true; scene.add(cap);
    const nk = new THREE.Mesh(new THREE.SphereGeometry(0.115,10,7), b.material);
    nk.position.set(px, y+1.19, pz); nk.scale.y = 0.55; scene.add(nk);
  }
  // обвязка-клеть, чтобы баллоны не валились
  for(const yy of [y+0.35, y+1.0]){
    addBox('steel', x, yy, z, 1.36, 0.05, 0.05, {rotY, collide:false, d:1});
  }
  for(const sx of [-0.66,0.66])
    addBox('steel', x+Math.cos(rotY)*sx, y+0.68, z-Math.sin(rotY)*sx, 0.05,1.36,0.05,
           {collide:false, d:1});
  addAABB(x, y+0.65, z, 1.5, 1.3, 0.34, rotY);
}
/* ---------- Биотуалет на стройплощадке ---------- */
function siteToilet(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const shell = cmat(0x3f6b52,{roughness:.62, metalness:.04});
  addBox('panel', x, y+0.04, z, 1.24, 0.08, 1.24, {rotY, d:.5});
  const G = new THREE.Group();
  for(const [dx,dz,sx,sz] of [[0,-0.56,1.12,0.05],[0.58,0,0.05,1.12],
                              [-0.58,0,0.05,1.12]]){
    const w = new THREE.Mesh(new THREE.BoxGeometry(sx,2.24,sz), shell);
    w.position.set(dx,1.2,dz); G.add(w);
  }
  // дверь приоткрыта — внутрь видно
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.0,2.16,0.05), shell);
  door.position.set(0.28,1.16,0.52); door.rotation.y = -0.62; G.add(door);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.26,0.07,1.26),
    cmat(0x9aa19c,{roughness:.7}));
  roof.position.y = 2.36; G.add(roof);
  // вентиляционная труба
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.055,0.7,8), M.darker);
  vent.position.set(-0.44,2.7,-0.44); G.add(vent);
  G.position.set(x,y+0.08,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(G); SHOOTABLE.push(G);
  addAABB(x, y+1.2, z, 1.24, 2.4, 1.24, rotY);
}
/* ---------- Барабан с кабелем на подставке ---------- */
function cableDrum(x,y,z){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  for(const s of [-1,1]){
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.62,0.52), M.steel);
    leg.position.set(s*0.52,0.31,0); G.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16,0.06,0.72), M.steel);
    foot.position.set(s*0.52,0.03,0); G.add(foot);
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,1.16,8), M.chrome);
  axle.rotation.z = Math.PI/2; axle.position.y = 0.62; G.add(axle);
  for(const s of [-1,1]){
    const cheek = new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.42,0.045,18), M.wood);
    cheek.rotation.z = Math.PI/2; cheek.position.set(s*0.22,0.62,0); G.add(cheek);
  }
  const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.33,0.33,0.38,16), M.cable);
  coil.rotation.z = Math.PI/2; coil.position.y = 0.62; G.add(coil);
  // свисающий конец кабеля
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0,0.95,0.0), new THREE.Vector3(0.5,0.42,0.3),
    new THREE.Vector3(1.1,0.04,0.55), new THREE.Vector3(1.9,0.03,0.3)]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(curve,14,0.024,5,false), M.cable);
  G.add(tail);
  G.position.set(x,y,z);
  G.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(G); SHOOTABLE.push(G);
  COLLIDERS.push({x0:x-0.6,y0:y,z0:z-0.45,x1:x+0.6,y1:y+1.05,z1:z+0.45});
}
/* ---------- Компрессор на колёсах ---------- */
function compressor(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.22,0.92,14),
    cmat(0x9c4a28,{roughness:.6, metalness:.3}));
  tank.rotation.z = Math.PI/2; tank.position.y = 0.3; G.add(tank);
  for(const s of [-1,1]){
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22,12,8), tank.material);
    cap.position.set(s*0.46,0.3,0); cap.scale.x = 0.55; G.add(cap);
  }
  const motor = new THREE.Mesh(roundedBox(0.4,0.3,0.3,0.05,2), M.dark);
  motor.position.set(-0.1,0.66,0); G.add(motor);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.12,0.24,10), M.steel);
  head.position.set(0.22,0.68,0); G.add(head);
  // ребристый радиатор и манометр
  for(let i=0;i<5;i++){
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.24,0.26), M.darker);
    fin.position.set(0.22-i*0.045,0.82,0); G.add(fin);
  }
  const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.055,0.02,10), M.chrome);
  gauge.rotation.x = Math.PI/2; gauge.position.set(0.34,0.56,0.08); G.add(gauge);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.6,7), M.steel);
  handle.rotation.z = 1.0; handle.position.set(-0.5,0.5,0); G.add(handle);
  for(const s of [-1,1]){
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.12,0.04,6,12), M.rubber);
    w.position.set(0.3,0.12,s*0.26); w.rotation.y = Math.PI/2; G.add(w);
  }
  // шланг кольцами на полу
  const hc = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.3,0.5,0.2), new THREE.Vector3(0.9,0.08,0.6),
    new THREE.Vector3(0.4,0.05,1.2), new THREE.Vector3(-0.3,0.05,0.8)], true);
  G.add(new THREE.Mesh(new THREE.TubeGeometry(hc,20,0.018,5,true), M.cable));
  G.position.set(x,y,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(G); SHOOTABLE.push(G);
  addAABB(x, y+0.45, z, 1.1, 0.9, 0.62, rotY);
}
/* ---------- Вязанка строп и хомутов ---------- */
function strapBundle(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  const strap = cmat(0xb07a2a,{roughness:.93});
  for(let i=0;i<5;i++){
    const r = 0.22 + i*0.03;
    const coil = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 5, 14), strap);
    coil.rotation.x = Math.PI/2 + sr(-0.12,0.12);
    coil.rotation.z = sr(0,3.14);
    coil.position.set(sr(-0.06,0.06), 0.04+i*0.055, sr(-0.06,0.06));
    G.add(coil);
  }
  // храповой механизм поверх
  const ratchet = new THREE.Mesh(roundedBox(0.16,0.09,0.24,0.02,2), M.steel);
  ratchet.position.set(0.1,0.34,0.02); ratchet.rotation.y = 0.5; G.add(ratchet);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.06,0.018,5,10,Math.PI*1.5), M.steel);
  hook.position.set(-0.22,0.32,0.1); hook.rotation.x = 0.8; G.add(hook);
  G.position.set(x,y,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(G); SHOOTABLE.push(G);
  COLLIDERS.push({x0:x-0.32,y0:y,z0:z-0.32,x1:x+0.32,y1:y+0.4,z1:z+0.32});
}
/* ---------- Учебный манекен на стойке ---------- */
function mannequin(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  const skin = cmat(0xb9a488,{roughness:.88, metalness:.02});
  const cloth = cmat(0x5d6450,{roughness:.93});
  // база-крестовина
  for(const a of [0, Math.PI/2]){
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.62,0.05,0.09), M.dark);
    b.rotation.y = a; b.position.y = 0.025; G.add(b);
  }
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.045,0.72,8), M.steel);
  post.position.y = 0.4; G.add(post);
  // корпус: торс, таз и голова
  const torso = new THREE.Mesh(roundedBox(0.42,0.62,0.24,0.10,3), cloth);
  torso.position.y = 1.12; G.add(torso);
  const hips = new THREE.Mesh(roundedBox(0.34,0.24,0.22,0.08,2), cloth);
  hips.position.y = 0.79; G.add(hips);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.065,0.1,8), skin);
  neck.position.y = 1.47; G.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115,12,10), skin);
  head.position.y = 1.59; head.scale.set(0.92,1.12,1.0); G.add(head);
  // руки чуть разведены, как у тренировочной фигуры
  for(const s of [-1,1]){
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055,0.42,4,8), cloth);
    arm.position.set(s*0.26,1.10,0.0); arm.rotation.z = s*0.28; G.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06,8,6), skin);
    hand.position.set(s*0.36,0.86,0.0); G.add(hand);
  }
  // мишенные зоны: контрастные круги на корпусе
  const tgt = cmat(0xb8452e,{roughness:.9});
  for(const [ty,tr] of [[1.22,0.09],[1.55,0.055]]){
    const c = new THREE.Mesh(new THREE.CircleGeometry(tr,14), tgt);
    c.position.set(0,ty,0.125); G.add(c);
  }
  G.position.set(x,y,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(G); SHOOTABLE.push(G);
  COLLIDERS.push({x0:x-0.28,y0:y,z0:z-0.22,x1:x+0.28,y1:y+1.7,z1:z+0.22});
}

/* ---------- Строительные леса: главный вертикальный объект недостроя ---------- */
function scaffold(x,y,z,rotY,bays=2,levels=2){
  y = snapSupport(x,z,y); if(y === null) return;
  // Леса высокие и с настилами: попав на марш, они срезают высоту прохода
  // по всей длине лестницы. Радиус проверки берём по габариту конструкции.
  const BW=1.9, BD=1.15, LH=1.95;
  for(let b=0;b<=bays;b++){
    for(const sd of [-1,1]){
      const ox = -bays*BW/2 + b*BW, oz = sd*BD/2;
      const px = x + Math.cos(rotY)*ox - Math.sin(rotY)*oz;
      const pz = z - Math.sin(rotY)*ox - Math.cos(rotY)*oz;
      addBox('steel', px, y+levels*LH/2, pz, 0.055, levels*LH, 0.055, {collide:false, d:1.2});
    }
  }
  for(let l=1;l<=levels;l++){
    const ly = y + l*LH;
    // ригели вдоль и поперёк
    addBox('steel', x, ly, z, bays*BW, 0.05, 0.05, {rotY, collide:false, d:1.2});
    for(const sd of [-1,1]){
      const oz = sd*BD/2;
      addBox('steel', x - Math.sin(rotY)*oz, ly-0.02, z - Math.cos(rotY)*oz,
             bays*BW, 0.05, 0.05, {rotY, collide:false, d:1.2});
    }
    // настил из досок
    for(let d=0;d<4;d++){
      const oz = -BD/2 + 0.16 + d*0.28;
      addBox('wood', x - Math.sin(rotY)*oz, ly+0.06, z - Math.cos(rotY)*oz,
             bays*BW-0.1, 0.035, 0.26, {rotY, collide:false, d:1.1});
    }
    addAABB(x, ly+0.05, z, bays*BW, 0.12, BD, rotY);
    // диагональные раскосы
    for(let b=0;b<bays;b++){
      const ox = -bays*BW/2 + b*BW + BW/2;
      const len = Math.hypot(BW, LH);
      const g = new THREE.BoxGeometry(len, 0.04, 0.04);
      g.rotateZ(Math.atan2(LH, BW) * (b%2?1:-1));
      _e.set(0,rotY,0); _q.setFromEuler(_e);
      const px = x + Math.cos(rotY)*ox, pz = z - Math.sin(rotY)*ox;
      _m4.compose(new THREE.Vector3(px, ly-LH/2, pz + (rotY?0:BD/2)), _q, new THREE.Vector3(1,1,1));
      g.applyMatrix4(_m4); bucket('steel').push(g);
    }
  }
}
/* ---------- Тачка ---------- */
function wheelbarrow(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const g = new THREE.Group();
  const tub = new THREE.Mesh(new THREE.BoxGeometry(0.72,0.26,0.54), M.paintY);
  tub.position.set(0,0.46,0); tub.rotation.z = 0.08;
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.3,0.5), M.paintY);
  front.position.set(0.36,0.52,0);
  g.add(tub, front);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17,0.055,8,14), M.rubber);
  wheel.position.set(0.44,0.17,0); wheel.rotation.y = Math.PI/2; g.add(wheel);
  for(const sd of [-1,1]){
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.34,0.04), M.steel);
    leg.position.set(-0.24,0.17,sd*0.22); g.add(leg);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(1.05,0.045,0.045), M.steel);
    handle.position.set(-0.22,0.44,sd*0.24); handle.rotation.z = -0.1; g.add(handle);
  }
  g.position.set(x,y,z); g.rotation.y = rotY;
  g.traverse(o=>{ o.castShadow=true; o.receiveShadow=true; });
  scene.add(g); SHOOTABLE.push(g);
  COLLIDERS.push({x0:x-0.7,y0:y,z0:z-0.5,x1:x+0.7,y1:y+0.7,z1:z+0.5});
}
/* ---------- Бетономешалка ---------- */
function mixer(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const g = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.30,0.62,16), M.paintY);
  drum.position.set(0,0.92,0); drum.rotation.z = 0.5; g.add(drum);
  const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.30,0.30,0.05,16), M.darker);
  mouth.position.set(0.24,1.17,0); mouth.rotation.z = 0.5; g.add(mouth);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.62,0.08,0.5), M.steel);
  frame.position.set(0,0.52,0); g.add(frame);
  for(const sx of [-1,1]) for(const sz of [-1,1]){
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05,0.52,0.05), M.steel);
    leg.position.set(sx*0.26,0.26,sz*0.2); g.add(leg);
  }
  for(const sd of [-1,1]){
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.14,0.05,7,12), M.rubber);
    w.position.set(-0.3,0.14,sd*0.22); w.rotation.y=Math.PI/2; g.add(w);
  }
  g.position.set(x,y,z); g.rotation.y=rotY;
  g.traverse(o=>{ o.castShadow=true; o.receiveShadow=true; });
  scene.add(g); SHOOTABLE.push(g);
  COLLIDERS.push({x0:x-0.55,y0:y,z0:z-0.45,x1:x+0.55,y1:y+1.3,z1:z+0.45});
}
/* ---------- Связки арматуры ---------- */
function rebar(x,y,z,rotY,n=14,len=4.0){
  y = snapSupport(x,z,y); if(y === null) return;
  const parts=[];
  for(let i=0;i<n;i++){
    const r = new THREE.CylinderGeometry(0.009,0.009,len,5);
    r.rotateZ(Math.PI/2);
    r.translate(sr(-0.06,0.06), 0.05 + Math.floor(i/5)*0.022, -0.16 + (i%5)*0.08);
    parts.push(r);
  }
  const m = new THREE.Mesh(BGU.mergeGeometries(parts,false), M.steel);
  m.position.set(x,y,z); m.rotation.y=rotY;
  m.castShadow=true; m.receiveShadow=true; scene.add(m); SHOOTABLE.push(m);
  addAABB(x, y+0.06, z, len, 0.14, 0.5, rotY);
}
/* ---------- Рулоны утеплителя ---------- */
function insulation(x,y,z,rotY,n=3){
  y = snapSupport(x,z,y); if(y === null) return;
  for(let i=0;i<n;i++){
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.29,0.29,1.05,14),
      cmat(i%2?0xc9b48a:0xb8a884,{roughness:.97}));
    r.rotation.z = Math.PI/2;
    r.position.set(x + Math.cos(rotY)*sr(-0.1,0.1), y+0.29+Math.floor(i/2)*0.56,
                   z - Math.sin(rotY)*(-0.3+ (i%2)*0.6));
    r.rotation.y = rotY;
    r.castShadow=true; r.receiveShadow=true; scene.add(r); SHOOTABLE.push(r);
  }
  addAABB(x, y+0.3, z, 1.15, 0.6*Math.ceil(n/2), 1.3, rotY);
}
/* ---------- Верстак с инструментом ---------- */
function workbench(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  addBox('wood', x, y+0.86, z, 2.0, 0.07, 0.72, {rotY, d:1.0});
  addBox('wood', x, y+0.42, z, 1.9, 0.04, 0.6, {rotY, collide:false, d:1.0});
  for(const sx of [-0.88,0.88]) for(const sz of [-0.3,0.3]){
    const px = x + Math.cos(rotY)*sx - Math.sin(rotY)*sz;
    const pz = z - Math.sin(rotY)*sx - Math.cos(rotY)*sz;
    addBox('wood', px, y+0.43, pz, 0.08, 0.86, 0.08, {collide:false, d:1.0});
  }
  // тиски и ящик с инструментом
  const vise = new THREE.Mesh(new THREE.BoxGeometry(0.2,0.16,0.14), M.steel);
  vise.position.set(x + Math.cos(rotY)*0.7, y+0.97, z - Math.sin(rotY)*0.7);
  vise.rotation.y = rotY; vise.castShadow=true; scene.add(vise);
  const tbox = new THREE.Mesh(new THREE.BoxGeometry(0.42,0.2,0.24), M.plastO);
  tbox.position.set(x - Math.cos(rotY)*0.5, y+1.0, z + Math.sin(rotY)*0.5);
  tbox.rotation.y = rotY + 0.2; tbox.castShadow=true; scene.add(tbox);
}
/* ---------- Свисающая плёнка / тент ---------- */
function hangingTarp(x,y,z,rotY,w=2.2,h=2.6){
  // Плёнка подвешена за верхнюю кромку и живёт как ткань: на сквозняке
  // в проёме она вздувается пузырём и опадает.
  const nx = Math.max(5, Math.round(9*Q.cloth)), ny = Math.max(4, Math.round(7*Q.cloth));
  const g = new THREE.PlaneGeometry(w, h, nx, ny);
  const m = new THREE.Mesh(g, cmat(0xbcc2c0,{roughness:.82, metalness:0,
    side:THREE.DoubleSide, transparent:true, opacity:.55}));
  m.position.set(x,y,z); m.rotation.y = rotY;
  m.castShadow = true; scene.add(m);
  // внутри здания ветер слабее: там только сквозняк из проёмов
}
/* ---------- Электрощит ---------- */
function panelBox(x,y,z,rotY){
  addBox('dark', x, y, z, 0.12, 0.62, 0.44, {rotY, collide:false, d:1.2});
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.56,0.40), M.paintG);
  door.position.set(x + Math.cos(rotY)*0.08, y, z - Math.sin(rotY)*0.08);
  door.rotation.y = rotY; door.castShadow=true; scene.add(door);
  // гофра вниз
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x, y-0.32, z),
    new THREE.Vector3(x+sr(-0.1,0.1), y-1.1, z+sr(-0.08,0.08)),
    new THREE.Vector3(x+sr(-0.15,0.15), y-1.9, z+sr(-0.1,0.1))
  ]);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve,10,0.022,6,false), M.cable);
  tube.castShadow=true; scene.add(tube);
}
/* ---------- Огнетушитель ---------- */
function extinguisher(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.083,0.083,0.42,12),
    cmat(0x8e3026,{roughness:.5,metalness:.25}));
  body.position.y = 0.24;
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.083,10,6), body.material);
  top.position.y = 0.45; top.scale.y = 0.55;
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.09,8), M.steel);
  valve.position.y = 0.53;
  g.add(body, top, valve);
  g.position.set(x,y,z); g.rotation.y = rotY;
  g.traverse(o=>o.castShadow=true); scene.add(g); SHOOTABLE.push(g);
}
/* ---------- Куча мусора / обрезков ---------- */
function debrisPile(x,y,z,r=0.9){
  y = snapSupport(x,z,y); if(y === null) return;
  const parts=[];
  for(let i=0;i<26;i++){
    const a=sr(0,6.28), d=sr(0,r);
    const g = new THREE.BoxGeometry(sr(0.1,0.55), sr(0.02,0.06), sr(0.05,0.2));
    _e.set(sr(-0.3,0.3), sr(0,6.28), sr(-0.25,0.25)); _q.setFromEuler(_e);
    _m4.compose(new THREE.Vector3(Math.cos(a)*d, 0.03+sr(0,0.14), Math.sin(a)*d), _q, new THREE.Vector3(1,1,1));
    g.applyMatrix4(_m4); parts.push(g);
  }
  const m = new THREE.Mesh(BGU.mergeGeometries(parts,false), M.wood);
  m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true;
  scene.add(m); SHOOTABLE.push(m);
}
/* ---------- Кирпичный поддон ---------- */
function bricks(x,y,z,rotY,rows=5){
  y = snapSupport(x,z,y); if(y === null) return;
  pallet(x,y,z,rotY,1);
  const bm = cmat(0x8a5f4a,{roughness:.92});
  const parts=[];
  for(let r=0;r<rows;r++) for(let i=0;i<5;i++) for(let j=0;j<3;j++){
    const g = new THREE.BoxGeometry(0.22,0.065,0.105);
    const off = r%2 ? 0.11 : 0;
    g.translate(-0.44+i*0.23+off, 0.17+r*0.07, -0.22+j*0.22);
    parts.push(g);
  }
  const m = new THREE.Mesh(BGU.mergeGeometries(parts,false), bm);
  m.position.set(x,y,z); m.rotation.y=rotY;
  m.castShadow=true; m.receiveShadow=true; scene.add(m); SHOOTABLE.push(m);
  addAABB(x, y+0.3, z, 1.2, 0.55, 0.8, rotY);
}
/* ---------- Оконная рама, прислонённая к стене ---------- */
function windowFrame(x,y,z,rotY,tilt=0.18){
  y = snapSupport(x,z,y); if(y === null) return;
  const g = new THREE.Group();
  const W=1.0,H=1.35;
  for(const [sx,sy,w,h] of [[0,H/2,W,0.06],[0,-H/2,W,0.06],[-W/2,0,0.06,H],[W/2,0,0.06,H],[0,0,W,0.05]]){
    const b = new THREE.Mesh(new THREE.BoxGeometry(w,h,0.055), M.wood);
    b.position.set(sx,sy,0); g.add(b);
  }
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(W-0.1,H-0.1), M.glass);
  gl.position.z = 0.01; g.add(gl);
  g.position.set(x, y+H/2*Math.cos(tilt), z);
  g.rotation.set(0, rotY, 0); g.rotateX(tilt);
  g.traverse(o=>{ o.castShadow=true; o.receiveShadow=true; });
  scene.add(g);
  COLLIDERS.push({x0:x-0.6,y0:y,z0:z-0.6,x1:x+0.6,y1:y+1.3,z1:z+0.6});
}

/* ============================================================================
   ТЕХНИКА: машины и вертолёт
   Все машины — статичные укрытия, без интерактива. Геометрия собирается из
   скруглённых объёмов: кузов, остекление, колёсные арки, хром, оптика.
============================================================================ */
/** Скруглённая коробка: база любого кузовного объёма.
    Дешевле ExtrudeGeometry и даёт корректные нормали для бликов. */
function wheelGroup(R=0.36, W=0.24, spokes=5){
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(R,R,W,22,1), M.rubber);
  tyre.rotation.z = Math.PI/2; g.add(tyre);
  // протектор: блоки по окружности
  const tread = [];
  for(let i=0;i<22;i++){
    const a = i/22*Math.PI*2;
    const b = new THREE.BoxGeometry(W*0.92, 0.035, R*0.17);
    b.translate(0, R-0.012, 0); b.rotateX(a);
    tread.push(b);
  }
  const tm = new THREE.Mesh(BGU.mergeGeometries(tread,false), M.rubber);
  tm.rotation.z = Math.PI/2; g.add(tm);
  // боковина: небольшой валик, иначе покрышка читается как труба
  for(const s of [-1,1]){
    const side = new THREE.Mesh(new THREE.TorusGeometry(R*0.88, R*0.1, 6, 20), M.rubber);
    side.position.x = s*W*0.44; side.rotation.y = Math.PI/2; g.add(side);
  }
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R*0.66,R*0.66,W*0.5,18), M.chrome);
  disc.rotation.z = Math.PI/2; g.add(disc);
  for(let i=0;i<spokes;i++){
    const sp = new THREE.Mesh(new THREE.BoxGeometry(W*0.3, R*1.15, R*0.16), M.chrome);
    sp.rotation.x = i*Math.PI/spokes; g.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(R*0.2,R*0.2,W*0.62,12), M.chrome);
  hub.rotation.z = Math.PI/2; g.add(hub);
  g.traverse(o=>{ o.castShadow=true; o.receiveShadow=true; });
  return g;
}
/** Легковой хэтчбек/седан: капот, салон, багажник, оптика, зеркала. */
function car(x,y,z,rotY, mat, opt={}){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  const L = opt.len ?? 4.3, W = opt.wid ?? 1.82, R = opt.wheel ?? 0.33;
  // Профиль по трём отметкам: низ порога, поясная линия (верх капота и
  // дверей) и крыша. Кузов уже колеи, поэтому колёса выступают по бортам
  // и не тонут в объёме — иначе машина читается как плита на катках.
  const sill = 0.38, belt = 1.02, roofY = 1.48;
  const bodyH = belt - sill, cabH = roofY - belt;
  const BW = W - R*0.62;                          // ширина кузова между арками
  const cabL = L*0.48, cabC = -L*0.07;            // длина и центр кабины

  // нижний объём кузова
  const body = new THREE.Mesh(roundedBox(L, bodyH, BW, 0.20, 4), mat);
  body.position.y = sill + bodyH/2; G.add(body);
  // «крылья» над колёсами: расширяют кузов только у арок
  for(const sx of [L*0.30, -L*0.31]){
    const fend = new THREE.Mesh(roundedBox(R*2.5, bodyH*0.86, W, 0.22, 4), mat);
    fend.position.set(sx, sill + bodyH*0.56, 0); G.add(fend);
  }
  // пороги между арками
  const rocker = new THREE.Mesh(roundedBox(L*0.44, bodyH*0.42, W*0.96, 0.08, 3), mat);
  rocker.position.set(cabC, sill + bodyH*0.22, 0); G.add(rocker);
  // скруглённые свесы носа и кормы
  for(const [px,len] of [[L*0.44, L*0.14], [-L*0.45, L*0.12]]){
    const end = new THREE.Mesh(roundedBox(len, bodyH*0.78, BW*0.96, 0.14, 3), mat);
    end.position.set(px, sill + bodyH*0.46, 0); G.add(end);
  }

  // кабина: уже кузова, с наклонными стойками
  const cab = new THREE.Mesh(roundedBox(cabL, cabH, BW*0.94, 0.16, 4), mat);
  cab.position.set(cabC, belt + cabH/2, 0); G.add(cab);
  const roof = new THREE.Mesh(roundedBox(cabL*0.74, 0.08, BW*0.84, 0.06, 3), mat);
  roof.position.set(cabC - L*0.01, roofY - 0.02, 0); G.add(roof);
  // Тёмный салон: без него стекло висит поверх кузовной краски и читается
  // как наклейка, а не как проём.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabL*0.94, cabH*0.86, BW*0.90),
    cmat(0x17181b,{roughness:.95}));
  cabin.position.set(cabC, belt + cabH*0.48, 0); G.add(cabin);

  /* --- остекление: плоскость сначала разворачивается по Y, потом
     наклоняется вокруг СВОЕЙ оси X (rotateX), иначе порядок Эйлера XYZ
     даёт скошенный «клин» вместо наклонного стекла. --- */
  const gl = (w,h,px,py,pz,ry,tilt)=>{
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h), M.carGlass);
    m.position.set(px,py,pz);
    m.rotation.set(0, ry||0, 0);
    if(tilt) m.rotateX(tilt);
    m.renderOrder = 1; G.add(m);
  };
  const winY = belt + cabH*0.52;
  gl(cabL*0.78, cabH*0.58, cabC, winY,  BW*0.474, 0);
  gl(cabL*0.78, cabH*0.58, cabC, winY, -BW*0.474, Math.PI);
  gl(BW*0.86, cabH*0.92, cabC+cabL*0.46, winY+0.02,  0,  Math.PI/2, -0.34);  // лобовое
  gl(BW*0.82, cabH*0.84, cabC-cabL*0.46, winY+0.02,  0, -Math.PI/2, -0.28);  // заднее
  // стойки A/B/C
  for(const [px,tilt] of [[cabC+cabL*0.46,-0.34],[cabC+cabL*0.02,0],[cabC-cabL*0.46,0.3]])
    for(const s of [-1,1]){
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, cabH*0.92, 0.05), mat);
      b.position.set(px, belt+cabH*0.5, s*BW*0.47); b.rotation.z = tilt; G.add(b);
    }

  /* --- бамперы, пороги, светотехника --- */
  for(const s of [1,-1]){
    const bump = new THREE.Mesh(roundedBox(0.16, 0.26, W*0.99, 0.07, 3), M.darker);
    bump.position.set(s*L*0.485, sill+0.12, 0); G.add(bump);
  }
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(L*0.46, 0.1, W*0.99), M.darker);
  skirt.position.set(cabC, sill + 0.01, 0); G.add(skirt);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, W*0.56), M.darker);
  grille.position.set(L*0.497, belt-0.26, 0); G.add(grille);
  for(const s of [-1,1]){
    const hl = new THREE.Mesh(roundedBox(0.08, 0.17, 0.36, 0.05, 2), M.headlamp);
    hl.position.set(L*0.492, belt-0.18, s*BW*0.34); G.add(hl);
    const tl = new THREE.Mesh(roundedBox(0.06, 0.18, 0.32, 0.05, 2), M.lightRed);
    tl.position.set(-L*0.494, belt-0.16, s*BW*0.34); G.add(tl);
    // зеркала на стойке A
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05,0.04,0.1), mat);
    arm.position.set(cabC+cabL*0.42, winY-0.06, s*BW*0.5); G.add(arm);
    const mir = new THREE.Mesh(roundedBox(0.09,0.1,0.17,0.035,2), mat);
    mir.position.set(cabC+cabL*0.42, winY-0.06, s*BW*0.58); G.add(mir);
    // ручки дверей на поясной линии
    for(const px of [cabC-L*0.14, cabC+L*0.10]){
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.16,0.04,0.035), M.chrome);
      h.position.set(px, belt-0.14, s*BW*0.51); G.add(h);
    }
    // молдинг по борту
    const trim = new THREE.Mesh(new THREE.BoxGeometry(L*0.5,0.05,0.03), M.darker);
    trim.position.set(cabC, belt-0.28, s*BW*0.51); G.add(trim);
  }
  // разрезы дверей
  for(const s of [-1,1]) for(const px of [cabC-cabL*0.5, cabC, cabC+cabL*0.5]){
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.012, bodyH*0.86, 0.006), M.darker);
    seam.position.set(px, sill+bodyH/2, s*BW*0.505); G.add(seam);
  }
  /* --- колёса в арках --- */
  for(const sx of [L*0.30, -L*0.31]) for(const sz of [-1,1]){
    const w = wheelGroup(R, 0.23, 5);
    w.position.set(sx, R, sz*(W/2-0.12));
    w.rotation.y = (opt.turn && sx>0) ? opt.turn : 0;
    G.add(w);
    // кромка арки: тёмное полукольцо по краю крыла
    const arch = new THREE.Mesh(new THREE.TorusGeometry(R*1.2, 0.05, 6, 16, Math.PI), M.darker);
    arch.position.set(sx, R, sz*(W/2-0.01)); arch.rotation.y = Math.PI/2; G.add(arch);
  }
  const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.05,0.16,10), M.chrome);
  exh.rotation.z = Math.PI/2; exh.position.set(-L*0.49, sill+0.06, W*0.26); G.add(exh);

  G.position.set(x,y,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  scene.add(G); SHOOTABLE.push(G);
  addAABB(x, y+roofY/2, z, L, roofY, W, rotY);
  return G;
}
/** Фургон/микроавтобус: высокий кузов, сдвижная дверь, лестница сзади. */
function van(x,y,z,rotY, mat, opt={}){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  const L = opt.len ?? 5.2, W = opt.wid ?? 2.0, R = 0.37;
  const sill = 0.34, boxH = 1.72;

  const body = new THREE.Mesh(roundedBox(L*0.74, boxH, W, 0.16, 4), mat);
  body.position.set(-L*0.12, sill+boxH/2, 0); G.add(body);
  // капот-«морда»
  const nose = new THREE.Mesh(roundedBox(L*0.30, boxH*0.62, W*0.96, 0.22, 4), mat);
  nose.position.set(L*0.34, sill+boxH*0.34, 0); G.add(nose);
  // тёмная кабина за стеклом
  const cabIn = new THREE.Mesh(new THREE.BoxGeometry(L*0.2, boxH*0.42, W*0.86),
    cmat(0x17181b,{roughness:.95}));
  cabIn.position.set(L*0.16, sill+boxH*0.70, 0); G.add(cabIn);
  const wind = new THREE.Mesh(new THREE.PlaneGeometry(W*0.88, boxH*0.48), M.carGlass);
  wind.position.set(L*0.20, sill+boxH*0.72, 0);
  wind.rotation.set(0, Math.PI/2, 0); wind.rotateX(-0.24); G.add(wind);
  for(const s of [-1,1]){
    const side = new THREE.Mesh(new THREE.PlaneGeometry(L*0.2, boxH*0.34), M.carGlass);
    side.position.set(L*0.10, sill+boxH*0.70, s*W*0.502);
    side.rotation.set(0, s>0 ? 0 : Math.PI, 0); G.add(side);
  }
  // гофры борта — жёсткость кузова
  for(const s of [-1,1]) for(let i=0;i<7;i++){
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, boxH*0.78, 0.03), mat);
    rib.position.set(-L*0.42 + i*L*0.10, sill+boxH*0.48, s*W*0.505); G.add(rib);
  }
  // задние створки со стеклом и ручками
  for(const s of [-1,1]){
    const dr = new THREE.Mesh(new THREE.BoxGeometry(0.05, boxH*0.92, W*0.46), mat);
    dr.position.set(-L*0.485, sill+boxH*0.5, s*W*0.245); G.add(dr);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(W*0.36, boxH*0.28), M.carGlass);
    gl.position.set(-L*0.512, sill+boxH*0.78, s*W*0.245);
    gl.rotation.y = -Math.PI/2; G.add(gl);
    const hd = new THREE.Mesh(new THREE.BoxGeometry(0.05,0.3,0.04), M.chrome);
    hd.position.set(-L*0.515, sill+boxH*0.45, s*0.1); G.add(hd);
    const tl = new THREE.Mesh(roundedBox(0.06,0.34,0.16,0.04,2), M.lightRed);
    tl.position.set(-L*0.50, sill+0.30, s*W*0.42); G.add(tl);
    const hl = new THREE.Mesh(roundedBox(0.08,0.18,0.28,0.05,2), M.headlamp);
    hl.position.set(L*0.485, sill+0.46, s*W*0.34); G.add(hl);
  }
  const bump = new THREE.Mesh(roundedBox(0.16,0.26,W*0.99,0.07,3), M.darker);
  bump.position.set(L*0.49, sill+0.10, 0); G.add(bump);
  const bumpR = new THREE.Mesh(roundedBox(0.14,0.24,W*0.99,0.07,3), M.darker);
  bumpR.position.set(-L*0.50, sill+0.10, 0); G.add(bumpR);
  // лестница на крышу и багажник
  for(const s of [-1,1]){
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L*0.6,0.05,0.05), M.steel);
    rail.position.set(-L*0.12, sill+boxH+0.06, s*W*0.36); G.add(rail);
  }
  for(let i=0;i<6;i++){
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.04,0.4), M.steel);
    st.position.set(-L*0.52, sill+0.34+i*0.26, W*0.30); G.add(st);
  }
  for(const sx of [L*0.32, -L*0.28]) for(const sz of [-1,1]){
    const w = wheelGroup(R, 0.26, 6);
    w.position.set(sx, R, sz*(W/2-0.11)); G.add(w);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(R*1.1, 0.06, 6, 14, Math.PI), M.darker);
    arch.position.set(sx, R, sz*(W/2-0.01)); arch.rotation.y = Math.PI/2; G.add(arch);
  }
  G.position.set(x,y,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  scene.add(G); SHOOTABLE.push(G);
  addAABB(x, y+(sill+boxH)/2, z, L, sill+boxH, W, rotY);
  return G;
}
/** Пикап с кунгом-каркасом: длинная база, рама, кузовной борт. */
function pickup(x,y,z,rotY, mat){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  const L = 5.0, W = 1.94, R = 0.40, sill = 0.46, cabH = 1.12;

  const frame = new THREE.Mesh(new THREE.BoxGeometry(L*0.92, 0.16, W*0.72), M.darker);
  frame.position.y = sill-0.08; G.add(frame);
  const cab = new THREE.Mesh(roundedBox(L*0.36, cabH, W, 0.18, 4), mat);
  cab.position.set(L*0.10, sill+cabH/2, 0); G.add(cab);
  const nose = new THREE.Mesh(roundedBox(L*0.26, cabH*0.62, W*0.97, 0.16, 4), mat);
  nose.position.set(L*0.40, sill+cabH*0.30, 0); G.add(nose);
  // грузовой борт
  const bedH = 0.56;
  for(const s of [-1,1]){
    const sidew = new THREE.Mesh(roundedBox(L*0.44, bedH, 0.09, 0.04, 2), mat);
    sidew.position.set(-L*0.24, sill+bedH/2, s*(W/2-0.05)); G.add(sidew);
  }
  const tail = new THREE.Mesh(roundedBox(0.09, bedH, W*0.96, 0.04, 2), mat);
  tail.position.set(-L*0.455, sill+bedH/2, 0); G.add(tail);
  const bedFloor = new THREE.Mesh(new THREE.BoxGeometry(L*0.46, 0.06, W*0.9), M.darker);
  bedFloor.position.set(-L*0.24, sill+0.03, 0); G.add(bedFloor);
  // дуги кунга
  for(const px of [-L*0.08, -L*0.24, -L*0.40]){
    const arc = new THREE.Mesh(new THREE.TorusGeometry(W*0.42, 0.035, 6, 14, Math.PI), M.steel);
    arc.position.set(px, sill+bedH, 0); arc.rotation.y = Math.PI/2; G.add(arc);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(L*0.36,0.04,0.04), M.steel);
  rail.position.set(-L*0.24, sill+bedH+W*0.42, 0); G.add(rail);
  // остекление кабины
  const wY = sill+cabH*0.68;
  const cabIn = new THREE.Mesh(new THREE.BoxGeometry(L*0.34, cabH*0.5, W*0.86),
    cmat(0x17181b,{roughness:.95}));
  cabIn.position.set(L*0.10, wY-0.04, 0); G.add(cabIn);
  const wind = new THREE.Mesh(new THREE.PlaneGeometry(W*0.86, cabH*0.48), M.carGlass);
  wind.position.set(L*0.275, wY, 0);
  wind.rotation.set(0, Math.PI/2, 0); wind.rotateX(-0.28); G.add(wind);
  const rear = new THREE.Mesh(new THREE.PlaneGeometry(W*0.82, cabH*0.38), M.carGlass);
  rear.position.set(-L*0.072, wY, 0); rear.rotation.set(0, -Math.PI/2, 0); G.add(rear);
  for(const s of [-1,1]){
    const side = new THREE.Mesh(new THREE.PlaneGeometry(L*0.26, cabH*0.38), M.carGlass);
    side.position.set(L*0.10, wY, s*W*0.502); side.rotation.set(0, s>0?0:Math.PI, 0); G.add(side);
    const hl = new THREE.Mesh(roundedBox(0.08,0.16,0.3,0.05,2), M.headlamp);
    hl.position.set(L*0.52, sill+0.34, s*W*0.32); G.add(hl);
    const tl = new THREE.Mesh(roundedBox(0.06,0.2,0.16,0.04,2), M.lightRed);
    tl.position.set(-L*0.47, sill+0.22, s*W*0.42); G.add(tl);
  }
  // силовой бампер и шноркель
  const bull = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.5,W*0.9), M.steel);
  bull.position.set(L*0.53, sill+0.16, 0); G.add(bull);
  for(const s of [-1,1]){
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.035,0.7,8), M.steel);
    bar.position.set(L*0.53, sill+0.4, s*0.32); G.add(bar);
  }
  const snork = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,1.3,10), M.darker);
  snork.position.set(L*0.26, sill+cabH*0.6, W*0.48); G.add(snork);
  for(const sx of [L*0.34, -L*0.30]) for(const sz of [-1,1]){
    const w = wheelGroup(R, 0.30, 6);
    w.position.set(sx, R, sz*(W/2-0.10)); G.add(w);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(R*1.14, 0.07, 6, 14, Math.PI), M.darker);
    arch.position.set(sx, R, sz*(W/2)); arch.rotation.y = Math.PI/2; G.add(arch);
  }
  G.position.set(x,y,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  scene.add(G); SHOOTABLE.push(G);
  addAABB(x, y+(sill+cabH)/2, z, L, sill+cabH, W, rotY);
  return G;
}
/** Кузов на подпорках без колёс — «донор» в углу гаража. */
function carWreck(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  const L=4.1, W=1.76, sill=0.42, bodyH=0.72, cabH=0.5;
  const shell = new THREE.Mesh(roundedBox(L,bodyH,W,0.24,4), M.carBlack);
  shell.position.y = sill+bodyH/2; G.add(shell);
  const cab = new THREE.Mesh(roundedBox(L*0.44,cabH,W*0.88,0.2,4), M.carBlack);
  cab.position.set(-L*0.04, sill+bodyH+cabH/2-0.06, 0); G.add(cab);
  // стёкол нет — проёмы обозначены тёмными вставками
  for(const s of [-1,1]){
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(L*0.34, cabH*0.6), M.darker);
    hole.position.set(-L*0.04, sill+bodyH+cabH*0.5, s*W*0.442);
    hole.rotation.y = s>0?0:Math.PI; G.add(hole);
  }
  // подпорки вместо колёс
  for(const sx of [L*0.3,-L*0.3]) for(const sz of [-1,1]){
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.22,sill,0.22), M.wood);
    st.position.set(sx, sill/2, sz*(W/2-0.16)); G.add(st);
  }
  G.position.set(x,y,z); G.rotation.y=rotY;
  G.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  scene.add(G); SHOOTABLE.push(G);
  addAABB(x, y+(sill+bodyH+cabH)/2, z, L, sill+bodyH+cabH, W, rotY);
}

/** Лёгкий вертолёт: кабина-«пузырь», хвостовая балка, полозья, несущий винт. */
function helipad(cx, cz){
  const R = 7.2;
  // подиум площадки: бетонная плита чуть выше пола
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.26, 48), M.helipad);
  pad.position.set(cx, 0.13, cz);
  pad.receiveShadow = true; pad.castShadow = true;
  scene.add(pad); SHOOTABLE.push(pad);
  COLLIDERS.push({x0:cx-R,y0:0,z0:cz-R,x1:cx+R,y1:0.26,z1:cz+R});
  // фаска-отбортовка
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 8, 48), M.dark);
  rim.rotation.x = Math.PI/2; rim.position.set(cx, 0.24, cz);
  rim.castShadow = true; scene.add(rim);

  /* --- периметр: сетчатое ограждение на стойках, с проходами --- */
  const fenceR = R + 1.9, posts = 28;
  const gates = [0.0, Math.PI/2, Math.PI, -Math.PI/2];   // четыре прохода
  // Угловое расстояние до ближайших ворот. Прежнее условие сравнивало его
  // с (PI - 0.30) и потому срабатывало почти всюду: проходов не оставалось,
  // и площадка была наглухо обнесена сеткой.
  const atGate = a => gates.some(g=>{
    const d = Math.abs(((a - g + Math.PI*3) % (Math.PI*2)) - Math.PI);
    return (Math.PI - d) < 0.42;
  });
  for(let i=0;i<posts;i++){
    const a = i/posts*Math.PI*2;
    if(atGate(a)) continue;
    const px = cx+Math.cos(a)*fenceR, pz = cz+Math.sin(a)*fenceR;
    addBox('steel', px, 0.62, pz, 0.09, 1.24, 0.09, {collide:false, d:1.1});
    // сегмент сетки между стойками
    const a2 = (i+1)/posts*Math.PI*2;
    if(atGate(a2)) continue;
    const qx = cx+Math.cos(a2)*fenceR, qz = cz+Math.sin(a2)*fenceR;
    const len = Math.hypot(qx-px, qz-pz);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.15),
      cmat(0x6d7377,{roughness:.86, metalness:.4, transparent:true,
        opacity:.34, side:THREE.DoubleSide}));
    mesh.position.set((px+qx)/2, 0.66, (pz+qz)/2);
    mesh.rotation.y = -Math.atan2(qz-pz, qx-px);
    scene.add(mesh);
    // верхняя и нижняя нитки
    for(const yy of [0.12, 1.20]){
      const g = new THREE.BoxGeometry(len, 0.045, 0.045);
      g.rotateY(-Math.atan2(qz-pz, qx-px));
      g.translate((px+qx)/2, yy, (pz+qz)/2);
      bucket('steel').push(g);
    }
    COLLIDERS.push({x0:Math.min(px,qx)-0.08, y0:0, z0:Math.min(pz,qz)-0.08,
                    x1:Math.max(px,qx)+0.08, y1:1.28, z1:Math.max(pz,qz)+0.08});
  }
  /* --- посадочные огни по кругу --- */
  for(let i=0;i<12;i++){
    const a = i/12*Math.PI*2;
    const px = cx+Math.cos(a)*(R-0.5), pz = cz+Math.sin(a)*(R-0.5);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.13,0.14,10), M.dark);
    base.position.set(px, 0.32, pz); base.castShadow = true; scene.add(base);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.075,10,8),
      i%3===0 ? M.lightRed : M.lightAmb);
    lens.position.set(px, 0.44, pz); scene.add(lens);
  }
  /* --- ветроуказатель --- */
  const wsX = cx - fenceR - 0.9, wsZ = cz + fenceR*0.55;
  addBox('steel', wsX, 2.4, wsZ, 0.12, 4.8, 0.12, {d:1.1});
  addBox('dark', wsX, 0.12, wsZ, 0.6, 0.24, 0.6, {d:1.2});
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34,0.03,6,16), M.steel);
  ring.position.set(wsX+0.36, 4.7, wsZ); ring.rotation.y = Math.PI/2;
  scene.add(ring);
  // конус: чередование полос, слегка отклонён
  for(let i=0;i<5;i++){
    const r0 = 0.33 - i*0.045, r1 = 0.33 - (i+1)*0.045;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 0.42, 12, 1, true),
      i%2 ? cmat(0xb4b0a4,{roughness:.92,side:THREE.DoubleSide})
          : cmat(0x9c4a28,{roughness:.92,side:THREE.DoubleSide}));
    seg.rotation.z = -Math.PI/2 + 0.16;
    seg.position.set(wsX+0.55+i*0.41, 4.70 - i*0.07, wsZ);
    seg.castShadow = true; scene.add(seg);
  }
  /* --- сам вертолёт, слегка развёрнут относительно оси H --- */
  HELI_HOOK(cx+0.4, 0.26, cz-0.3, -0.42);
  /* --- наземное обслуживание --- */
  // тележка-буксировщик
  const cart = new THREE.Group();
  const cbody = new THREE.Mesh(roundedBox(1.5,0.42,0.9,0.1,3), M.paintY);
  cbody.position.y = 0.42; cart.add(cbody);
  const chandle = new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.035,1.1,8), M.steel);
  chandle.rotation.z = 0.9; chandle.position.set(1.05,0.6,0); cart.add(chandle);
  for(const sx of [-0.5,0.5]) for(const sz of [-1,1]){
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.17,0.055,7,12), M.rubber);
    w.position.set(sx,0.17,sz*0.42); w.rotation.y=Math.PI/2; cart.add(w);
  }
  cart.position.set(cx-4.6, 0.26, cz+3.6); cart.rotation.y = 0.5;
  cart.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(cart); SHOOTABLE.push(cart);
  addAABB(cx-4.6, 0.26+0.35, cz+3.6, 1.8, 0.7, 1.1, 0.5);
  // топливные бочки под навесом и огнетушители
  barrel(cx-5.4, 0.26, cz-3.2, 'green'); barrel(cx-4.7, 0.26, cz-3.8, 'green');
  barrel(cx-5.6, 0.26, cz-4.2, null, true);
  extinguisher(cx+4.8, 0.26, cz+4.2, 0);
  extinguisher(cx+5.2, 0.26, cz+4.2, 0);
  cone(cx+3.6, 0.26, cz+5.0); cone(cx-3.2, 0.26, cz+5.2);
  // мачта прожекторов над площадкой
  const mx = cx + fenceR*0.72, mz = cz - fenceR*0.72;
  addBox('steel', mx, 3.3, mz, 0.16, 6.6, 0.16, {d:1.1});
  addBox('dark', mx, 0.14, mz, 0.7, 0.28, 0.7, {d:1.2});
  for(const a of [0.6, 1.2]){
    const head = new THREE.Mesh(roundedBox(0.44,0.3,0.2,0.05,2), M.dark);
    head.position.set(mx - Math.cos(a)*0.4, 6.5, mz + Math.sin(a)*0.4);
    head.rotation.y = a; head.castShadow = true; scene.add(head);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.36,0.24),
      new THREE.MeshBasicMaterial({color:0xdad6c4}));
    lens.position.set(mx - Math.cos(a)*0.52, 6.45, mz + Math.sin(a)*0.52);
    lens.rotation.y = a - Math.PI/2; lens.rotation.x = -0.3; scene.add(lens);
  }
  return {cx, cz, R, fenceR};
}

function concBlock(x,y,z,rotY, len=1.6, h=0.62){
  y = snapSupport(x,z,y); if(y === null) return;
  addBox('panel', x, y+h/2, z, len, h, 0.6, {rotY, d:.5});
  // монтажные петли
  for(const s of [-1,1]){
    const o = s*len*0.28;
    const lp = new THREE.Mesh(new THREE.TorusGeometry(0.075,0.017,5,10,Math.PI), M.steel);
    lp.position.set(x+Math.cos(rotY)*o, y+h+0.02, z-Math.sin(rotY)*o);
    lp.rotation.y = rotY; lp.castShadow = true; scene.add(lp);
  }
}
/** Стенка из блоков в два-три ряда: главное линейное укрытие. */
function blockWall(x,z,rotY, len=6.0, rows=2){
  const n = Math.max(1, Math.round(len/1.6));
  for(let r=0;r<rows;r++){
    const off = r%2 ? 0.8 : 0;                   // перевязка швов
    for(let i=0;i<n;i++){
      const t = -len/2 + 0.8 + i*1.6 + off;
      if(Math.abs(t) > len/2) continue;
      if(r>0 && srnd()<0.22) continue;           // выбитые блоки верхнего ряда
      const px = x + Math.cos(rotY)*t, pz = z - Math.sin(rotY)*t;
      concBlock(px, r*0.62, pz, rotY + sr(-0.03,0.03), 1.55, 0.62);
    }
  }
}
/** Бытовка / блок-контейнер: дверь, окно, крыша с уклоном. */
function cabin(x,y,z,rotY, w=2.4, d=5.6, h=2.5, col=0x7b8076){
  y = snapSupport(x,z,y); if(y === null) return;
  const mat = cmat(col,{roughness:.8,metalness:.32});
  const G = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(d,h,w), mat);
  body.position.y = h/2 + 0.16; G.add(body);
  // гофра борта
  for(let i=0;i<Math.round(d/0.4);i++) for(const s of [-1,1]){
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.06,h*0.9,0.04), mat);
    rib.position.set(-d/2+0.2+i*0.4, h/2+0.16, s*(w/2+0.02)); G.add(rib);
  }
  // крыша с небольшим свесом
  const roof = new THREE.Mesh(new THREE.BoxGeometry(d+0.2, 0.1, w+0.2), M.roof);
  roof.position.y = h+0.2; G.add(roof);
  // дверь и окно
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.0, 0.85), M.darker);
  door.position.set(d/2+0.01, 1.16, -w*0.2); G.add(door);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.06,0.2), M.chrome);
  hand.position.set(d/2+0.06, 1.1, -w*0.2+0.3); G.add(hand);
  for(const px of [-d*0.3, d*0.14]){
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.8), M.glass);
    win.position.set(px, 1.72, w/2+0.03); win.rotation.y = 0; G.add(win);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(1.1,0.9,0.05), M.darker);
    fr.position.set(px, 1.72, w/2+0.01); G.add(fr);
    // решётка на окне
    for(let i=0;i<4;i++){
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.82,0.03), M.steel);
      b.position.set(px-0.4+i*0.27, 1.72, w/2+0.06); G.add(b);
    }
  }
  // опорные брусья и ступень
  for(const sx of [-1,1]) for(const sz of [-1,1]){
    const blk = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.16,0.5), M.panel);
    blk.position.set(sx*(d/2-0.5), 0.08, sz*(w/2-0.4)); G.add(blk);
  }
  const step = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.16,1.0), M.steel);
  step.position.set(d/2+0.32, 0.4, -w*0.2); G.add(step);
  G.position.set(x,y,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(G); SHOOTABLE.push(G);
  addAABB(x, y+(h+0.26)/2, z, d, h+0.26, w, rotY);
}
/** Бетонная труба: круглое укрытие, сквозь которое можно пролезть. */
function pipeStack(x,y,z,rotY,n=3){
  y = snapSupport(x,z,y); if(y === null) return;
  const R = 0.72, L = 2.4;
  const lay = [[0,0],[1,0],[2,0],[0.5,1],[1.5,1],[1,2]];
  for(let i=0;i<Math.min(n*2,lay.length);i++){
    const [c,r] = lay[i];
    const ox = (c-1)*R*2.05, oy = R + r*R*1.78;
    const px = x - Math.sin(rotY)*ox, pz = z - Math.cos(rotY)*ox;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(R,R,L,20,1,true), M.panel);
    tube.rotation.z = Math.PI/2; tube.rotation.y = rotY;
    tube.position.set(px, y+oy, pz); tube.castShadow = tube.receiveShadow = true;
    scene.add(tube); SHOOTABLE.push(tube);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(R*0.82,R*0.82,L*0.99,20,1,true),
      cmat(0x6d6a63,{roughness:.96,side:THREE.BackSide}));
    inner.rotation.z = Math.PI/2; inner.rotation.y = rotY; inner.position.copy(tube.position);
    scene.add(inner);
    // раструбы по торцам
    for(const s of [-1,1]){
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R*0.91, R*0.09, 6, 20), M.panel);
      rim.position.set(px + Math.cos(rotY)*s*L/2, y+oy, pz - Math.sin(rotY)*s*L/2);
      rim.rotation.y = rotY + Math.PI/2; scene.add(rim);
    }
    // стенки трубы твёрдые, а просвет — проходной
    for(const so of [-1,1])
      COLLIDERS.push({x0:px-(rotY?0.2:L/2)-0.2, y0:y+oy+so*R*0.86-0.16,
                      z0:pz-(rotY?L/2:0.2)-0.2, x1:px+(rotY?0.2:L/2)+0.2,
                      y1:y+oy+so*R*0.86+0.16, z1:pz+(rotY?L/2:0.2)+0.2});
  }
}
/** Катушка кабеля и ящик с песком — мелкие модули для заполнения. */
function sandBox(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  addBox('wood', x, y+0.3, z, 1.5, 0.6, 0.9, {rotY, d:1.0});
  const sand = new THREE.Mesh(new THREE.BoxGeometry(1.36,0.14,0.78), M.dirt);
  sand.position.set(x, y+0.62, z); sand.rotation.y = rotY;
  sand.castShadow = sand.receiveShadow = true; scene.add(sand);
  const shovel = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.04,1.1), M.wood);
  shovel.position.set(x+0.4, y+0.68, z); shovel.rotation.y = rotY+0.4;
  shovel.castShadow = true; scene.add(shovel);
}

/* --- Пять точек интереса и модульные укрытия между ними --- */

export { meshAt, barrel, tire, pallet, spool, cone, lumberPile, osbStack, leanSheet, sawhorse, ladder, bags,
         paintBucket, crate as staticCrate, jerseyBarrier, sandbags, toolCart, gasBottles, siteToilet, cableDrum,
         compressor, strapBundle, scaffold, wheelbarrow, mixer, rebar, insulation, workbench, panelBox,
         extinguisher, debrisPile, bricks, wheelGroup, car, van, pickup, carWreck, helipad, concBlock, blockWall,
         cabin, pipeStack, sandBox };
