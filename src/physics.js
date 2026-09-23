// Физика на Ammo.js (Bullet): статический мир, обломки, персонаж, ткань флагов.
import { THREE } from './engine.js';
import { COLLIDERS, normCollider, ensureColor } from './builder.js';

export const GRP = { STATIC:1, DYN:2, DEBRIS:4, CHAR:8, PROJ:16 };
/** Коды поверхностей статики, хранятся в userIndex тела как отрицательные числа. */
export const SURF_CODE = { conc:-2, metal:-3, wood:-4, sand:-5, glass:-6 };
export const SURF_NAME = { '-2':'conc', '-3':'metal', '-4':'wood', '-5':'sand', '-6':'glass' };

export const PH = {
  A:null, world:null, ready:false,
  dyn:[],               // {body, mesh, life, owner, sleepT}
  owners:[],            // userIndex ≥ 0 → владелец (разрушаемый элемент, обломок)
  soft:[],              // флаги
  onContact:null,       // (pos, impulse, a, b) — звуки ударов
  maxDyn: 220,
  t1:null, t2:null, v1:null, v2:null, q1:null
};
let A, world;

export async function initPhysics(){
  // ammo.wasm.js подключён классическим <script>: он объявляет глобальную фабрику Ammo.
  A = PH.A = await window.Ammo({ locateFile: p => 'lib/ammo/' + p });
  const cc = new A.btSoftBodyRigidBodyCollisionConfiguration();
  const disp = new A.btCollisionDispatcher(cc);
  const bp = new A.btDbvtBroadphase();
  const solver = new A.btSequentialImpulseConstraintSolver();
  const softSolver = new A.btDefaultSoftBodySolver();
  world = PH.world = new A.btSoftRigidDynamicsWorld(disp, bp, solver, cc, softSolver);
  world.setGravity(new A.btVector3(0,-9.81,0));
  world.getWorldInfo().set_m_gravity(new A.btVector3(0,-9.81,0));
  world.getWorldInfo().set_air_density(1.2);
  world.getPairCache().setInternalGhostPairCallback(new A.btGhostPairCallback());
  PH.disp = disp;
  PH.t1 = new A.btTransform(); PH.t2 = new A.btTransform();
  PH.v1 = new A.btVector3(); PH.v2 = new A.btVector3(); PH.q1 = new A.btQuaternion(0,0,0,1);
  PH.ready = true;
}

/* ---------- формы и тела ---------- */
export function boxShape(hx,hy,hz){
  const s = new A.btBoxShape(new A.btVector3(hx,hy,hz));
  s.setMargin(Math.min(0.02, Math.min(hx,hy,hz)*0.5));
  return s;
}
function makeBody(shape, mass, pos, quat, opt={}){
  const tr = new A.btTransform(); tr.setIdentity();
  tr.setOrigin(new A.btVector3(pos.x, pos.y, pos.z));
  if(quat) tr.setRotation(new A.btQuaternion(quat.x, quat.y, quat.z, quat.w));
  const ms = new A.btDefaultMotionState(tr);
  const inertia = new A.btVector3(0,0,0);
  if(mass > 0) shape.calculateLocalInertia(mass, inertia);
  const info = new A.btRigidBodyConstructionInfo(mass, ms, shape, inertia);
  const body = new A.btRigidBody(info);
  A.destroy(info); A.destroy(inertia); A.destroy(tr);
  body.setFriction(opt.friction ?? 0.8);
  body.setRestitution(opt.restitution ?? 0.1);
  if(opt.rolling) body.setRollingFriction(opt.rolling);
  body._shape = shape; body._ms = ms;
  return body;
}
/** Статический бокс из записи коллайдера. */
export function addStaticCollider(c, userIndex){
  normCollider(c);
  const shape = boxShape(Math.max(c.hx,0.005), Math.max(c.hy,0.005), Math.max(c.hz,0.005));
  const q = c.q ? {x:c.q[0], y:c.q[1], z:c.q[2], w:c.q[3]} : null;
  const body = makeBody(shape, 0, {x:c.cx, y:c.cy, z:c.cz}, q, {friction:0.9});
  body.setUserIndex(userIndex ?? (SURF_CODE[c.surf] ?? -2));
  const mask = c.playerOnly ? GRP.CHAR : (c.noPlayer ? (GRP.DYN|GRP.DEBRIS|GRP.PROJ) : -1);
  world.addRigidBody(body, GRP.STATIC, mask);
  c.body = body;
  return body;
}
export function buildStaticWorld(){
  let n = 0;
  for(const c of COLLIDERS){ if(c.body || c.skipPhys) continue; addStaticCollider(c); n++; }
  return n;
}
/** Статическое составное тело (лист обшивки из оставшихся кусков). parts: [{cx,cy,cz,hx,hy,hz}] в мире. */
export function addStaticCompound(parts, quat, userIndex, origin){
  const cs = new A.btCompoundShape(true);
  const lt = new A.btTransform();
  const qi = new THREE.Quaternion(quat.x,quat.y,quat.z,quat.w).invert();
  const shapes = [];
  const o = origin;
  for(const p of parts){
    const s = boxShape(p.hx, p.hy, p.hz); shapes.push(s);
    const lp = new THREE.Vector3(p.cx-o.x, p.cy-o.y, p.cz-o.z).applyQuaternion(qi);
    lt.setIdentity(); lt.setOrigin(new A.btVector3(lp.x, lp.y, lp.z));
    cs.addChildShape(lt, s);
  }
  A.destroy(lt);
  const body = makeBody(cs, 0, o, quat, {friction:0.9});
  body._children = shapes;
  body.setUserIndex(userIndex);
  world.addRigidBody(body, GRP.STATIC, -1);
  return body;
}
export function removeBody(body){
  if(!body) return;
  world.removeRigidBody(body);
  if(body._children) for(const s of body._children) A.destroy(s);
  A.destroy(body._shape); A.destroy(body._ms); A.destroy(body);
}
export function registerOwner(o){ PH.owners.push(o); return PH.owners.length-1; }

/** Динамическое тело, привязанное к мешу. shape — 'box' (по размерам) | 'sphere' | 'cyl' | Ammo-форма. */
export function addDynamic(mesh, opt={}){
  let shape;
  const s = opt.size || [0.2,0.2,0.2];
  if(opt.shape === 'sphere') shape = new A.btSphereShape(opt.radius ?? 0.1);
  else if(opt.shape === 'cyl'){ shape = new A.btCylinderShape(new A.btVector3(s[0]/2, s[1]/2, s[0]/2)); shape.setMargin(0.01); }
  else if(opt.shape && typeof opt.shape === 'object') shape = opt.shape;
  else shape = boxShape(Math.max(s[0]/2,0.004), Math.max(s[1]/2,0.004), Math.max(s[2]/2,0.004));
  const mass = opt.mass ?? 1;
  const body = makeBody(shape, mass, mesh.position, mesh.quaternion,
    {friction:opt.friction ?? 0.7, restitution:opt.restitution ?? 0.15, rolling:opt.rolling});
  body.setDamping(opt.linDamp ?? 0.05, opt.angDamp ?? 0.25);
  if(opt.vel){ PH.v1.setValue(opt.vel.x, opt.vel.y, opt.vel.z); body.setLinearVelocity(PH.v1); }
  if(opt.spin){ PH.v1.setValue(opt.spin.x, opt.spin.y, opt.spin.z); body.setAngularVelocity(PH.v1); }
  if(opt.ccd){ body.setCcdMotionThreshold(opt.ccd); body.setCcdSweptSphereRadius(opt.ccd*0.8); }
  const grp = opt.group ?? GRP.DEBRIS;
  const mask = opt.mask ?? (grp === GRP.DEBRIS ? (GRP.STATIC|GRP.DYN|GRP.DEBRIS|GRP.PROJ)
                        : (GRP.STATIC|GRP.DYN|GRP.DEBRIS|GRP.CHAR|GRP.PROJ));
  world.addRigidBody(body, grp, mask);
  const rec = { body, mesh, life: opt.life ?? 30, age:0, owner: opt.owner || null, surf: opt.surf || 'wood',
                sleepT:0, fade:0, onStep: opt.onStep || null, keep: !!opt.keep };
  const idx = registerOwner({type:'dyn', rec});
  body.setUserIndex(idx); rec.idx = idx;
  mesh.userData.nomerge = true;
  mesh.traverse(ensureColor);
  PH.dyn.push(rec);
  // жёсткий потолок: самые старые обломки уходят первыми
  if(PH.dyn.length > PH.maxDyn){
    const old = PH.dyn.find(r=>!r.keep);
    if(old) old.life = Math.min(old.life, old.age + 0.5);
  }
  return rec;
}
export function killDynamic(rec){
  const i = PH.dyn.indexOf(rec); if(i>=0) PH.dyn.splice(i,1);
  PH.owners[rec.idx] = null;
  removeBody(rec.body);
  if(rec.mesh){ rec.mesh.removeFromParent(); if(rec.mesh.userData.ownGeo) rec.mesh.geometry.dispose(); }
}
export function impulse(body, ix,iy,iz, rx=0,ry=0,rz=0){
  body.activate(true);
  PH.v1.setValue(ix,iy,iz); PH.v2.setValue(rx,ry,rz);
  body.applyImpulse(PH.v1, PH.v2);
}
/** Импульс взрыва всем динамическим телам в радиусе. */
export function blastImpulse(p, R, power){
  for(const r of PH.dyn){
    const tr = r.body.getWorldTransform().getOrigin();
    const dx = tr.x()-p.x, dy = tr.y()-p.y, dz = tr.z()-p.z;
    const d = Math.hypot(dx,dy,dz);
    if(d > R || d < 1e-3) continue;
    const k = power * Math.pow(1 - d/R, 1.6) / d;
    impulse(r.body, dx*k, dy*k + Math.abs(k)*0.35*d, dz*k,
            (Math.random()-0.5)*0.05, (Math.random()-0.5)*0.05, (Math.random()-0.5)*0.05);
  }
}

/* ---------- лучи ---------- */
/** Все пересечения отрезка, отсортированные по дальности. */
export function rayAll(from, to, mask=-1){
  PH.v1.setValue(from.x,from.y,from.z); PH.v2.setValue(to.x,to.y,to.z);
  const cb = new A.AllHitsRayResultCallback(PH.v1, PH.v2);
  cb.set_m_collisionFilterGroup(-1); cb.set_m_collisionFilterMask(mask);
  world.rayTest(PH.v1, PH.v2, cb);
  const out = [];
  if(cb.hasHit()){
    const objs = cb.get_m_collisionObjects(), fr = cb.get_m_hitFractions(),
          pts = cb.get_m_hitPointWorld(), nrm = cb.get_m_hitNormalWorld();
    for(let i=0;i<objs.size();i++){
      const p = pts.at(i), n = nrm.at(i);
      out.push({ idx: objs.at(i).getUserIndex(), f: fr.at(i),
                 p: new THREE.Vector3(p.x(),p.y(),p.z()), n: new THREE.Vector3(n.x(),n.y(),n.z()) });
    }
  }
  A.destroy(cb);
  out.sort((a,b)=>a.f-b.f);
  return out;
}
/** Ближайшее пересечение (или null). */
export function rayFirst(from, to, mask=GRP.STATIC){
  PH.v1.setValue(from.x,from.y,from.z); PH.v2.setValue(to.x,to.y,to.z);
  const cb = new A.ClosestRayResultCallback(PH.v1, PH.v2);
  cb.set_m_collisionFilterGroup(-1); cb.set_m_collisionFilterMask(mask);
  world.rayTest(PH.v1, PH.v2, cb);
  let out = null;
  if(cb.hasHit()){
    const p = cb.get_m_hitPointWorld(), n = cb.get_m_hitNormalWorld();
    out = { f: cb.get_m_closestHitFraction(), idx: cb.get_m_collisionObject().getUserIndex(),
            p: new THREE.Vector3(p.x(),p.y(),p.z()), n: new THREE.Vector3(n.x(),n.y(),n.z()) };
  }
  A.destroy(cb);
  return out;
}

/* ---------- персонаж ---------- */
export function makeCharacter(pos, radius=0.32, height=1.1, stepH=0.42){
  const shape = new A.btCapsuleShape(radius, height);
  const ghost = new A.btPairCachingGhostObject();
  const tr = new A.btTransform(); tr.setIdentity();
  tr.setOrigin(new A.btVector3(pos.x, pos.y, pos.z));
  ghost.setWorldTransform(tr); A.destroy(tr);
  ghost.setCollisionShape(shape);
  ghost.setCollisionFlags(16);               // CF_CHARACTER_OBJECT
  ghost.setUserIndex(-10);
  const kcc = new A.btKinematicCharacterController(ghost, shape, stepH, 1);
  kcc.setGravity(19.0); kcc.setJumpSpeed(6.4); kcc.setFallSpeed(40);
  kcc.setMaxSlope(52*Math.PI/180);
  kcc.setUseGhostSweepTest(true);
  world.addCollisionObject(ghost, GRP.CHAR, GRP.STATIC|GRP.DYN);
  world.addAction(kcc);
  const walk = new A.btVector3(0,0,0), wv = new A.btVector3(0,0,0);
  return {
    kcc, ghost, radius, height, half: height/2 + radius,
    setWalk(x,z){ walk.setValue(x,0,z); kcc.setWalkDirection(walk); },
    warp(p){ wv.setValue(p.x,p.y,p.z); kcc.warp(wv); },
    pos(out){ const o = ghost.getWorldTransform().getOrigin(); return out.set(o.x(),o.y(),o.z()); },
    onGround(){ return kcc.onGround(); },
    jump(){ if(kcc.canJump()) kcc.jump(); },
    enable(on){
      if(on && !this._on){ world.addCollisionObject(ghost, GRP.CHAR, GRP.STATIC|GRP.DYN); world.addAction(kcc); }
      if(!on && this._on){ world.removeAction(kcc); world.removeCollisionObject(ghost); }
      this._on = on;
    },
    _on:true
  };
}

/* ---------- ткань (флаги) ---------- */
/** Полотнище на мачте: сетка узлов Bullet soft body, кромка у древка закреплена.
    hoistTop — верхний угол у древка, along — единичный вектор к свободному краю. */
export function makeFlagCloth(mat, hoistTop, along, W, H, nx, ny){
  const wi = world.getWorldInfo();
  const sbh = new A.btSoftBodyHelpers();
  const P = (u,v)=> new A.btVector3(hoistTop.x + along.x*u, hoistTop.y - v, hoistTop.z + along.z*u);
  const soft = sbh.CreatePatch(wi, P(0,0), P(W,0), P(0,H), P(W,H), nx, ny, 0, true);
  const cfg = soft.get_m_cfg();
  cfg.set_viterations(6); cfg.set_piterations(8);
  cfg.set_kDP(0.004); cfg.set_kDG(0.0); cfg.set_kLF(0.0);
  cfg.set_collisions(0);
  const m0 = soft.get_m_materials().at(0);
  m0.set_m_kLST(0.95); m0.set_m_kAST(0.9);
  soft.generateBendingConstraints(2, m0);
  soft.setTotalMass(0.9, false);
  const N = nx*ny;
  for(let j=0;j<ny;j++) soft.setMass(j*nx, 0);        // шкаторина у древка
  world.addSoftBody(soft, 1, -1);
  A.destroy(sbh);
  // геометрия с тем же порядком узлов: индекс = i + j*nx
  const pos = new Float32Array(N*3), uv = new Float32Array(N*2);
  const nodes = soft.get_m_nodes();
  for(let k=0;k<N;k++){
    const x = nodes.at(k).get_m_x(); pos[k*3]=x.x(); pos[k*3+1]=x.y(); pos[k*3+2]=x.z();
    const i = k % nx, j = Math.floor(k/nx);
    uv[k*2] = i/(nx-1); uv[k*2+1] = 1 - j/(ny-1);
  }
  const idx = [];
  for(let j=0;j<ny-1;j++) for(let i=0;i<nx-1;i++){
    const a=i+j*nx, b=a+1, c=a+nx, d=c+1;
    idx.push(a,c,b, b,c,d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(uv,2));
  g.setIndex(idx); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.userData.nomerge = true;
  const rec = { soft, mesh, nx, ny, N, tris: idx, area: W*H, gust: Math.random()*10 };
  PH.soft.push(rec);
  return rec;
}
const _fa = new THREE.Vector3(), _fb = new THREE.Vector3(), _fc = new THREE.Vector3(), _fn = new THREE.Vector3(), _fv = new THREE.Vector3();
/** Ветер давит на каждый треугольник по его нормали: полотнище само ловит поток. */
function windOnCloth(rec, wind, extra){
  const nodes = rec.soft.get_m_nodes(), t = rec.tris;
  const F = new Float32Array(rec.N*3);
  const X = rec._x || (rec._x = new Float32Array(rec.N*3)), V = rec._vv || (rec._vv = new Float32Array(rec.N*3));
  for(let k=0;k<rec.N;k++){
    const nd = nodes.at(k), x = nd.get_m_x(), v = nd.get_m_v();
    X[k*3]=x.x(); X[k*3+1]=x.y(); X[k*3+2]=x.z(); V[k*3]=v.x(); V[k*3+1]=v.y(); V[k*3+2]=v.z();
  }
  for(let i=0;i<t.length;i+=3){
    const a=t[i], b=t[i+1], c=t[i+2];
    _fa.set(X[b*3]-X[a*3], X[b*3+1]-X[a*3+1], X[b*3+2]-X[a*3+2]);
    _fb.set(X[c*3]-X[a*3], X[c*3+1]-X[a*3+1], X[c*3+2]-X[a*3+2]);
    _fn.crossVectors(_fa,_fb); const area2 = _fn.length(); if(area2 < 1e-8) continue;
    _fn.multiplyScalar(1/area2);
    _fv.set(wind.x - (V[a*3]+V[b*3]+V[c*3])/3, wind.y - (V[a*3+1]+V[b*3+1]+V[c*3+1])/3, wind.z - (V[a*3+2]+V[b*3+2]+V[c*3+2])/3);
    const vn = _fn.dot(_fv);
    // 0.5·ρ·Cd·S·v²; вдоль полотна — слабое трение потока (рябь)
    const f = 0.5*1.2*1.1*(area2*0.5)*vn*Math.abs(vn);
    for(const k of [a,b,c]){ F[k*3]+=_fn.x*f/3; F[k*3+1]+=_fn.y*f/3; F[k*3+2]+=_fn.z*f/3; }
  }
  for(let k=0;k<rec.N;k++){
    let fx=F[k*3], fy=F[k*3+1], fz=F[k*3+2];
    if(extra){ fx+=extra.x; fy+=extra.y; fz+=extra.z; }
    PH.v1.setValue(fx,fy,fz); rec.soft.addForce(PH.v1, k);
  }
  return X;
}
/** Удар по ткани: взрыв или пуля. */
export function pokeCloth(p, R, power){
  for(const rec of PH.soft){
    const nodes = rec.soft.get_m_nodes();
    for(let k=0;k<rec.N;k++){
      const x = nodes.at(k).get_m_x();
      const dx=x.x()-p.x, dy=x.y()-p.y, dz=x.z()-p.z, d=Math.hypot(dx,dy,dz);
      if(d > R || d < 1e-4) continue;
      const s = power*(1-d/R)/d;
      PH.v1.setValue(dx*s, dy*s, dz*s); rec.soft.addForce(PH.v1, k);
    }
  }
}

/* ---------- шаг ---------- */
const _tq = new THREE.Quaternion();
export function stepPhysics(dt, wind){
  if(!PH.ready) return;
  for(const rec of PH.soft) rec._X = windOnCloth(rec, wind, rec.push);
  world.stepSimulation(dt, 4, 1/90);
  // синхронизация мешей
  for(let i=PH.dyn.length-1;i>=0;i--){
    const r = PH.dyn[i];
    r.age += dt;
    if(r.age > r.life){
      // исчезают, проваливаясь в пол — не хлопком
      r.fade += dt;
      if(r.fade > 1.2){ killDynamic(r); continue; }
      r.mesh.scale.setScalar(Math.max(0.01, 1 - r.fade/1.2));
    }
    const ms = r.body.getMotionState();
    ms.getWorldTransform(PH.t1);
    const o = PH.t1.getOrigin(), q = PH.t1.getRotation();
    r.mesh.position.set(o.x(), o.y(), o.z());
    r.mesh.quaternion.set(q.x(), q.y(), q.z(), q.w());
    if(o.y() < -5) { killDynamic(r); continue; }
    if(r.onStep) r.onStep(r, dt);
  }
  for(const rec of PH.soft){
    const nodes = rec.soft.get_m_nodes();
    const pa = rec.mesh.geometry.attributes.position;
    for(let k=0;k<rec.N;k++){ const x = nodes.at(k).get_m_x(); pa.setXYZ(k, x.x(), x.y(), x.z()); }
    pa.needsUpdate = true; rec.mesh.geometry.computeVertexNormals();
  }
  // контакты: звук и пыль от сильных ударов
  if(PH.onContact){
    const n = PH.disp.getNumManifolds();
    let fired = 0;
    for(let i=0;i<n && fired<4;i++){
      const m = PH.disp.getManifoldByIndexInternal(i);
      const nc = m.getNumContacts(); if(!nc) continue;
      const b0 = m.getBody0(), b1 = m.getBody1();
      const i0 = b0.getUserIndex(), i1 = b1.getUserIndex();
      const o0 = i0 >= 0 ? PH.owners[i0] : null, o1 = i1 >= 0 ? PH.owners[i1] : null;
      const dyn = (o0 && o0.type==='dyn') ? o0.rec : (o1 && o1.type==='dyn') ? o1.rec : null;
      if(!dyn) continue;
      let best = 0, bp = null;
      for(let k=0;k<nc;k++){ const cp = m.getContactPoint(k); const imp = cp.getAppliedImpulse();
        if(imp > best){ best = imp; bp = cp.get_m_positionWorldOnA(); } }
      if(best > 0.25 && bp && (!dyn._lastHit || dyn.age - dyn._lastHit > 0.15)){
        dyn._lastHit = dyn.age;
        PH.onContact(new THREE.Vector3(bp.x(),bp.y(),bp.z()), best, dyn);
        fired++;
      }
    }
  }
}
