// Оружие: автомат (хитскан с пробитием дерева), осколочная граната (тело
// Bullet с запалом), зажигательная бутылка. Взрывы: огненный шар, ударная
// волна, воронка в бетоне, гарь на стенах, дым, пожар.
import { THREE, scene, camera, Q, clamp, lerp, rnd, sr } from './engine.js';
import { M, cmat } from './materials.js';
import { PH, GRP, rayAll, rayFirst, addDynamic, killDynamic, SURF_NAME, impulse } from './physics.js';
import { FXS, SND, Chips } from './fx.js';
import { bulletHit, explode, floorBelow, HOOKS, impactFX, DEST, breakProp } from './destruction.js';
import { ignite, addFire } from './fire.js';
import { PL, INPUT, hurt, keys } from './player.js';
import { roundedBox } from './builder.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x=0,y=0,z=0)=> new THREE.Vector3(x,y,z);
export const WPN = { mag:30, magMax:30, reloadT:0, cool:0, fired:0, frags:3, fire:2, nadeCool:0, viewmodel:null, kick:0, stats:{shots:0} };
const GRENADES = [];

/* ---------- модель автомата от первого лица ---------- */
function buildViewmodel(){
  const G = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({color:0x1f2022, roughness:.45, metalness:.75, envMapIntensity:1.1});
  const metal2 = new THREE.MeshStandardMaterial({color:0x2c2d2f, roughness:.55, metalness:.6});
  const wood = new THREE.MeshStandardMaterial({color:0x4a2a17, roughness:.5, metalness:.02, envMapIntensity:.7});
  const add = (geo, mat, x,y,z, rx=0,ry=0,rz=0)=>{ const m = new THREE.Mesh(geo, mat); m.position.set(x,y,z); m.rotation.set(rx,ry,rz); G.add(m); return m; };
  add(roundedBox(0.05, 0.075, 0.34, 0.01, 2), metal, 0, 0, 0);                      // ствольная коробка
  add(new THREE.BoxGeometry(0.046, 0.02, 0.3), metal2, 0, 0.045, -0.01);             // крышка
  add(new THREE.CylinderGeometry(0.009, 0.009, 0.42, 10), metal, 0, 0.012, -0.38, Math.PI/2);  // ствол
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 8), metal, 0, 0.038, -0.3, Math.PI/2);    // газовая трубка
  add(roundedBox(0.056, 0.05, 0.2, 0.012, 2), wood, 0, 0.0, -0.26);                  // цевьё
  add(roundedBox(0.05, 0.035, 0.17, 0.01, 2), wood, 0, 0.042, -0.29);                // накладка
  add(new THREE.BoxGeometry(0.012, 0.035, 0.014), metal, 0, 0.042, -0.56);           // мушка
  add(new THREE.BoxGeometry(0.03, 0.02, 0.03), metal, 0, 0.06, -0.06);               // целик
  add(new THREE.CylinderGeometry(0.014, 0.012, 0.05, 8), metal, 0, 0.012, -0.61, Math.PI/2);   // ДТК
  // изогнутый магазин из трёх секций
  for(let i=0;i<3;i++) add(roundedBox(0.03, 0.075, 0.06, 0.006, 1), metal2, 0, -0.07 - i*0.06, -0.06 + i*0.022, -0.35 - i*0.12, 0, 0);
  add(roundedBox(0.035, 0.1, 0.045, 0.01, 2), wood, 0, -0.07, 0.11, 0.35, 0, 0);    // рукоять
  add(new THREE.BoxGeometry(0.008, 0.03, 0.05), metal, 0, -0.045, 0.05);             // спуск
  add(roundedBox(0.042, 0.08, 0.22, 0.015, 2), wood, 0, -0.03, 0.27, 0.12, 0, 0);   // приклад
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({map:FXS.flash.mesh.material.uniforms.map.value,
    color:0xffc07a, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, opacity:0}));
  flash.position.set(0, 0.012, -0.68); G.add(flash);
  const flash2 = flash.clone(); flash2.rotation.y = Math.PI/2; flash2.material = flash.material; G.add(flash2);
  G.userData.flash = flash.material;
  G.traverse(o=>{ if(o.isMesh){ o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; o.renderOrder = 10; } });
  G.userData.nomerge = true;
  camera.add(G);
  return G;
}
export function initWeapons(){
  WPN.viewmodel = buildViewmodel();
  HOOKS.barrel = p => barrelExplode(p);
  HOOKS.leak = (p, at)=> setTimeout(()=>{ if(!p.dead) addFire(V(p.center.x, p.center.y+0.2, p.center.z), {t:'p', p}, {I:0.6, fuel:30}); }, 400 + Math.random()*800);
}
const _dir = V(), _org = V(), _to = V(), _q = new THREE.Quaternion();
/* ---------- выстрел ---------- */
function shoot(){
  WPN.mag--; WPN.cool = 1/11; WPN.fired++; WPN.stats.shots++;
  camera.getWorldPosition(_org);
  camera.getWorldDirection(_dir);
  const moving = clamp(PL.speed/4.3, 0, 1.5);
  const spread = (0.0025 + moving*0.012 + (PL.onGround?0:0.03)) * (1 - PL.ads*0.8) + Math.min(WPN.kick, 1)*0.01;
  _dir.x += rnd(-spread, spread); _dir.y += rnd(-spread, spread); _dir.z += rnd(-spread, spread); _dir.normalize();
  _to.copy(_org).addScaledVector(_dir, 160);
  const hits = rayAll(_org, _to, GRP.STATIC|GRP.DYN|GRP.DEBRIS);
  let power = 1.0, end = _to.clone(), stopped = false;
  const seen = new Set();
  for(const h of hits){
    if(h.idx === -10) continue;                       // сам игрок
    const key = h.idx >= 0 ? h.idx : 'st'+h.p.x.toFixed(2)+h.p.z.toFixed(2);
    if(seen.has(key) && h.idx >= 0) continue; seen.add(key);
    const r = bulletHit(h, _dir, power);
    power -= r.cost;
    if(r.stop || power < 0.15){ end = h.p.clone(); stopped = true; break; }
  }
  // дерево, пробитое насквозь, оставляет выходные отверстия — это делает bulletHit
  // трассер: каждый третий патрон
  if(WPN.fired % 3 === 0){
    const mz = muzzleWorld();
    const d = end.clone().sub(mz), L = d.length();
    FXS.spark.spawn({p: mz.clone().addScaledVector(d, 0.3/Math.max(L,1)), v: d.clone().normalize().multiplyScalar(260), life: Math.min(0.5, L/260), s0:0.05, s1:0.04, col:[1,0.8,0.5], a0:1, a1:0.6, drag:0});
  }
  // вспышка, отдача, звук
  WPN.viewmodel.userData.flash.opacity = 1; WPN.viewmodel.children.at(-1).rotation.z = Math.random()*3;
  FXS.flashes.fire(muzzleWorld(), 0xffb060, 4, 7, 0.06);
  PL.recoil += 0.012 + rnd(0, 0.006)*(1-PL.ads*0.5);
  PL.yaw += rnd(-0.0025, 0.0025);
  WPN.kick = Math.min(WPN.kick + 0.35, 2);
  SND.shot(null, true);
  const mz = muzzleWorld();
  FXS.smoke.spawn({p:mz, v:_dir.clone().multiplyScalar(0.6).add(V(0,0.3,0)), life:1.2, s0:0.05, s1:0.4, col:[0.5,0.5,0.5], a0:0.25, a1:0, drag:2});
  // гильза
  const ej = V(0.06, 0.02, -0.05).applyQuaternion(camera.quaternion).add(camera.position);
  FXS.splinters.spawn(ej, V(0.9,1.2,0.2).applyQuaternion(camera.quaternion).add(V(rnd(-.3,.3),rnd(0,.4),rnd(-.3,.3))), V(0.009,0.009,0.03), PL.eye.y - 1.6, 4);
}
function muzzleWorld(){ return V(0.0, 0.012, -0.68).applyMatrix4(WPN.viewmodel.matrixWorld); }

/* ---------- граната ---------- */
let nadeGeo = null;
function throwNade(kind){
  camera.getWorldDirection(_dir);
  const p = V(0.18, -0.1, -0.4).applyMatrix4(camera.matrixWorld);
  let mesh;
  if(kind === 'frag'){
    if(!nadeGeo){ nadeGeo = new THREE.SphereGeometry(0.045, 12, 10); nadeGeo.scale(1, 1.25, 1); }
    mesh = new THREE.Mesh(nadeGeo, cmat(0x3d4430, {roughness:.7, metalness:.3}));
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.02), M.steel); lever.position.set(0.035, 0.03, 0); mesh.add(lever);
  } else {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.22, 10), new THREE.MeshStandardMaterial({color:0x3f5a2a, roughness:.1, metalness:.1, transparent:true, opacity:.8}));
    const rag = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.08, 6), cmat(0xd9c9a0,{roughness:1})); rag.position.y = 0.14; mesh.add(rag);
  }
  mesh.castShadow = true; mesh.position.copy(p); scene.add(mesh);
  const speed = kind === 'frag' ? 14 : 12;
  const vel = _dir.clone().multiplyScalar(speed).add(V(0, 2.2, 0)).add(PL.vel.clone().multiplyScalar(0.8));
  const rec = addDynamic(mesh, { shape: kind==='frag' ? 'sphere' : 'box', radius:0.05, size:[0.09,0.22,0.09],
    mass: kind==='frag' ? 0.4 : 0.7, vel, spin:V(rnd(-10,10),rnd(-10,10),rnd(-10,10)), restitution: kind==='frag'?0.38:0.1,
    friction:0.7, rolling:0.08, ccd:0.04, life:30, group:GRP.PROJ, surf:'metal', keep:true });
  rec.kind = kind; rec.fuse = kind==='frag' ? 3.2 : 9;
  rec.isNade = true;
  GRENADES.push(rec);
  SND.click();
}
/** Удар о препятствие: бутылка бьётся сразу, граната звякает. */
export function onContact(p, imp, rec){
  if(rec.isNade){
    if(rec.kind === 'fire' && rec.age > 0.05 && !rec.done){ rec.done = true; molotov(rec, p); }
    else if(rec.kind === 'frag' && imp > 0.05) SND.bounce(p);
    return;
  }
  if(imp > 0.6) SND.thud(p, imp, rec.surf);
}
function molotov(rec, p){
  const at = rec.mesh.position.clone();
  killDynamic(rec); GRENADES.splice(GRENADES.indexOf(rec),1);
  SND.glass(at, 8);
  for(let i=0;i<14;i++) FXS.glassChips.spawn(at, V(rnd(-2,2),rnd(0.5,2.5),rnd(-2,2)), V(rnd(0.02,0.05),rnd(0.02,0.05),1), floorBelow(at), 8);
  for(let i=0;i<24;i++) FXS.fireball.spawn({p:at.clone().add(V(rnd(-.3,.3),rnd(0,.3),rnd(-.3,.3))), v:V(rnd(-2.5,2.5), rnd(0.5,3), rnd(-2.5,2.5)),
    life:rnd(0.4,0.9), s0:rnd(0.3,0.6), s1:rnd(0.6,1.1), col:[1,0.65,0.3], a0:0.9, a1:0, drag:2.5});
  FXS.flashes.fire(at, 0xff8a3a, 20, 10, 0.8);
  ignite(at, 1.0, 2.2, true);
}
/* ---------- взрыв ---------- */
const CRATERS = [];
export function blastFX(p, big=1){
  FXS.flashes.fire(p.clone().add(V(0,0.4,0)), 0xffb070, 90*big, 22*big, 0.35);
  FXS.flash.spawn({p: p.clone().add(V(0,0.3,0)), life:0.12, s0:4*big, s1:6*big, col:[1,0.85,0.6], a0:1, a1:0});
  for(let i=0;i<Math.round(28*big);i++){
    const d = V(rnd(-1,1), rnd(-0.2,1), rnd(-1,1)).normalize();
    FXS.fireball.spawn({p: p.clone().addScaledVector(d, rnd(0,0.4)), v: d.multiplyScalar(rnd(3,9)*big), life:rnd(0.25,0.6),
      s0:rnd(0.6,1.2)*big, s1:rnd(1.2,2.2)*big, col:[1, rnd(0.55,0.75), 0.3], a0:1, a1:0, drag:6, rot:rnd(0,6), spin:rnd(-2,2)});
  }
  for(let i=0;i<Math.round(40*big);i++){
    const d = V(rnd(-1,1), rnd(0,1.2), rnd(-1,1)).normalize();
    FXS.spark.spawn({p: p.clone(), v: d.multiplyScalar(rnd(8,26)), life:rnd(0.3,0.9), s0:0.05, s1:0.015, col:[1,0.75,0.35], a0:1, a1:0, g:-9.8, drag:0.6});
  }
  for(let i=0;i<Math.round(16*big);i++){
    const d = V(rnd(-1,1), rnd(0.1,1), rnd(-1,1)).normalize(); const g = rnd(0.08,0.18);
    FXS.smoke.spawn({p: p.clone().addScaledVector(d, rnd(0.2,0.8)), v: d.multiplyScalar(rnd(1,4)).add(V(0,1,0)), life:rnd(5,10),
      s0:rnd(0.8,1.4)*big, s1:rnd(3,5)*big, col:[g,g*0.95,g*0.9], a0:0.55, a1:0, drag:1.2, turb:0.4, fadeIn:0.1});
  }
  const fy = floorBelow(p);
  if(p.y - fy < 1.2){
    // пыль кольцом по полу
    for(let i=0;i<18;i++){ const a = i/18*Math.PI*2;
      FXS.dust.spawn({p: V(p.x, fy+0.2, p.z), v: V(Math.cos(a)*rnd(4,7), rnd(0.2,0.8), Math.sin(a)*rnd(4,7)), life:rnd(2.5,4.5),
        s0:0.6, s1:2.4, col:[0.62,0.6,0.56], a0:0.5, a1:0, drag:2.2, fadeIn:0.05}); }
  }
  SND.explosion(p, big);
}
export function grenadeExplode(p, big=1){
  blastFX(p, big);
  const fy = floorBelow(p);
  const floorHit = rayFirst(V(p.x, p.y+0.1, p.z), V(p.x, p.y-2, p.z), GRP.STATIC);
  const onConcrete = floorHit && floorHit.idx < 0 && (SURF_NAME[floorHit.idx]==='conc') && p.y - fy < 0.6;
  if(onConcrete) crater(V(p.x, fy, p.z), big);
  scorch(p, big);
  explode(p, {radius: 6*big, power: big});
}
/** Воронка в бетоне: выбитая чаша (декаль с нормалями), вал крошки, куски плиты. */
function crater(p, big){
  const R = rnd(1.0, 1.35)*big;
  const dec = new THREE.Mesh(new THREE.PlaneGeometry(R*2, R*2), M.crater);
  dec.rotation.x = -Math.PI/2; dec.rotation.z = rnd(0,6.28); dec.position.set(p.x, p.y+0.006, p.z);
  dec.receiveShadow = true; dec.renderOrder = 1; dec.userData.nomerge = true; scene.add(dec);
  // вал выброса: неровные куски бетона по кольцу, один меш
  const parts = [];
  const n = 22;
  for(let i=0;i<n;i++){
    const a = i/n*Math.PI*2 + rnd(-0.1,0.1), rr = R*rnd(0.5,0.78);
    const g = new THREE.DodecahedronGeometry(rnd(0.05,0.13)*big, 0);
    g.scale(rnd(0.8,1.6), rnd(0.4,0.8), rnd(0.8,1.4)); g.rotateY(rnd(0,6.28));
    g.translate(p.x + Math.cos(a)*rr, p.y + 0.02, p.z + Math.sin(a)*rr);
    for(const k of Object.keys(g.attributes)) if(!['position','normal','uv'].includes(k)) g.deleteAttribute(k);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  const rim = new THREE.Mesh(BGU.mergeGeometries(parts, false), M.conc);
  rim.castShadow = true; rim.receiveShadow = true; rim.userData.nomerge = true; scene.add(rim);
  CRATERS.push(dec, rim);
  while(CRATERS.length > 32){ const o = CRATERS.shift(); o.removeFromParent(); o.geometry.dispose(); }
  // куски плиты — телами, крошка — частицами
  for(let i=0;i<Math.round(5*big);i++){
    const s = rnd(0.07, 0.16);
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), M.conc); m.userData.ownGeo = true;
    m.position.set(p.x + rnd(-0.3,0.3), p.y + 0.15, p.z + rnd(-0.3,0.3)); m.castShadow = true; scene.add(m);
    addDynamic(m, {shape:'sphere', radius:s*0.85, mass: s*s*s*2400*4, vel:V(rnd(-5,5), rnd(4,9), rnd(-5,5)), spin:V(rnd(-9,9),rnd(-9,9),rnd(-9,9)),
      life: sr(30,50), surf:'conc', group:GRP.DEBRIS, restitution:0.25});
  }
  for(let i=0;i<30;i++) FXS.concChips.spawn(V(p.x, p.y+0.1, p.z), V(rnd(-5,5), rnd(3,10), rnd(-5,5)), rnd(0.015,0.05), p.y, rnd(8,20));
}
/** Гарь на ближайших поверхностях. */
function scorch(p, big){
  for(const d of [V(0,-1,0), V(1,0,0), V(-1,0,0), V(0,0,1), V(0,0,-1), V(0,1,0)]){
    const h = rayFirst(p, p.clone().addScaledVector(d, 2.2*big), GRP.STATIC);
    if(!h) continue;
    const k = 1 - h.f;
    FXS.decals.add(h.p, h.n, (2.4 + rnd(0,0.8))*big*(0.5+k*0.5), 4, null);
  }
}
function barrelExplode(p){
  const c = p.center.clone();
  setTimeout(()=>{
    blastFX(c, 1.3);
    explode(c, {radius: 7, power: 1.25, fire: 1.0});
    const fy = floorBelow(c);
    for(let i=0;i<5;i++) addFire(V(c.x + rnd(-1.5,1.5), fy+0.02, c.z + rnd(-1.5,1.5)), null, {I:0.9, fuel:rnd(14,26)});
    scorch(c, 1.3);
    // бочку разрывает: обечайка улетает вверх
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.26, 0.6, 14, 1, true), cmat(0x3a1a12,{roughness:.8, metalness:.4, side:THREE.DoubleSide}));
    m.position.copy(c).add(V(0,0.3,0)); m.userData.ownGeo = true; m.castShadow = true; scene.add(m);
    addDynamic(m, {shape:'cyl', size:[0.56,0.6,0.56], mass:8, vel:V(rnd(-2,2), rnd(8,12), rnd(-2,2)), spin:V(rnd(-6,6),rnd(-6,6),rnd(-6,6)),
      life:60, surf:'metal', group:GRP.DYN});
  }, 60);
}

/* ---------- кадр ---------- */
let swayT = 0;
export function updateWeapons(dt, t){
  WPN.cool -= dt; WPN.nadeCool -= dt; WPN.kick = Math.max(0, WPN.kick - dt*2.5);
  const vm = WPN.viewmodel;
  if(vm.userData.flash.opacity > 0) vm.userData.flash.opacity = Math.max(0, vm.userData.flash.opacity - dt*28);
  // перезарядка
  if(WPN.reloadT > 0){ WPN.reloadT -= dt; if(WPN.reloadT <= 0){ WPN.mag = WPN.magMax; } }
  const canFire = PL.alive && !PL.fly && INPUT.locked && WPN.reloadT <= 0 && !PL.sprint;
  if(canFire && INPUT.mouseDown && WPN.cool <= 0){
    if(WPN.mag > 0) shoot(); else { WPN.cool = 0.25; SND.click(); WPN.reloadT = 2.2; }
  }
  // гранаты — учебные, запас восполняется
  WPN.frags = Math.min(3, WPN.frags + dt/6); WPN.fire = Math.min(2, WPN.fire + dt/9);
  for(let i=GRENADES.length-1;i>=0;i--){
    const g = GRENADES[i]; g.fuse -= dt;
    if(g.kind === 'frag' && g.fuse <= 0){
      const p = g.mesh.position.clone();
      killDynamic(g); GRENADES.splice(i,1);
      grenadeExplode(p, 1);
    } else if(g.fuse <= 0 && !g.done){ g.done = true; molotov(g, g.mesh.position); }
  }
  // положение модели: прицеливание, бег, покачивание, отдача, перезарядка
  swayT += dt*(PL.speed > 0.5 ? (PL.sprint ? 11 : 8) : 1.5);
  const ads = PL.ads, run = PL.sprint ? 1 : 0;
  const rl = WPN.reloadT > 0 ? Math.sin(clamp(1 - WPN.reloadT/2.2, 0, 1)*Math.PI) : 0;
  const bobA = (PL.speed > 0.5 ? 0.012 : 0.003) * (1-ads*0.85);
  vm.position.set(lerp(0.13, 0.0, ads) + Math.cos(swayT)*bobA + run*0.05,
                  lerp(-0.135, -0.086, ads) - Math.abs(Math.sin(swayT))*bobA - rl*0.12 - run*0.03,
                  lerp(-0.5, -0.4, ads) + WPN.kick*0.012 + PL.recoil*0.4);
  vm.rotation.set(PL.recoil*1.4 - rl*0.6 + run*-0.3, run*0.6 + rl*0.3, rl*0.5 + run*0.25);
  vm.visible = PL.alive && !PL.fly;
}
export function weaponKey(code){
  if(!PL.alive || PL.fly) return;
  if(code === 'KeyR' && WPN.reloadT <= 0 && WPN.mag < WPN.magMax){ WPN.reloadT = 2.2; SND.click(); }
  if(code === 'KeyG' && WPN.frags >= 1 && WPN.nadeCool <= 0){ WPN.frags -= 1; WPN.nadeCool = 0.9; throwNade('frag'); }
  if(code === 'KeyT' && WPN.fire >= 1 && WPN.nadeCool <= 0){ WPN.fire -= 1; WPN.nadeCool = 0.9; throwNade('fire'); }
}
/** Урон игроку от ударной волны: с проверкой укрытия. */
export function playerBlast(p, R, P){
  const eye = PL.eye, d = eye.distanceTo(p);
  if(d < R*2.5) PL.shake = Math.min(1.2, PL.shake + (1 - d/(R*2.5))*1.1*P);
  if(d > R) return;
  const block = rayFirst(p.clone().add(V(0,0.2,0)), eye, GRP.STATIC);
  const cover = block && block.f < 0.95 ? 0.3 : 1;
  const k = Math.pow(1 - d/R, 1.4);
  hurt(160*P*k*cover, 'blast');
  if(k*cover > 0.25) PL.deaf = Math.min(1, PL.deaf + k*cover);
  const push = V().subVectors(eye, p).setY(0).normalize().multiplyScalar(6*k*cover);
  PL.vel.add(push);
}
