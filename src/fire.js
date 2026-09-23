// Огонь: очаги на горючих элементах. Очаг разгорается, обугливает древесину
// вокруг, съедает прочность куска, перекидывается вверх и в стороны и гаснет,
// когда кончается топливо. Пламя, дым, искры, свет и звук — отсюда же.
import { THREE, camera, Q, clamp, lerp, rnd } from './engine.js';
import { FXS, SND } from './fx.js';
import { query, refFlammable, refNormal, refPos, burnDamage, charSphere, coolDown, flushDestruction, HOOKS, floorBelow } from './destruction.js';
import { scene } from './engine.js';

export const FIRES = [];
const MAXF = Q.lights >= 6 ? 46 : (Q.lights >= 5 ? 32 : 20);
const LIGHTS = [];
const V = (x=0,y=0,z=0)=> new THREE.Vector3(x,y,z);

export function initFire(){
  const n = Math.max(2, Math.min(5, Q.lights-1));
  for(let i=0;i<n;i++){
    const L = new THREE.PointLight(0xff8a3a, 0, 9, 1.8);
    L.position.set(0,-40,0); scene.add(L); LIGHTS.push(L);
  }
  HOOKS.ignite = ignite;
}
/** Очаг рядом с элементом ref (или свободный — лужа топлива, ref=null). */
export function addFire(p, ref, o={}){
  if(FIRES.length >= MAXF) return null;
  for(const f of FIRES) if(f.p.distanceToSquared(p) < 0.25) { f.fuel += 4; return f; }
  const n = ref ? refNormal(ref, o.from || camera.position) : V(0,1,0);
  const f = { p: p.clone().addScaledVector(n, 0.05), n, ref, I: o.I ?? 0.15, target: 1,
              fuel: o.fuel ?? rnd(28,45), t:0, spreadT: rnd(1.5,3), free: !ref, dmgT:0, lightK:0 };
  FIRES.push(f);
  return f;
}
/** Поджог в точке: ищет горючее в радиусе r и ставит несколько очагов. */
export function ignite(p, strength=0.6, r=1.5, puddle=false){
  const cand = query(p, r, refFlammable).sort((a,b)=>a.d-b.d);
  let n = Math.round(1 + strength*4);
  for(const c of cand){
    if(n <= 0) break;
    if(Math.random() > strength + 0.3) continue;
    addFire(c.pos, c.ref, {I: 0.3 + strength*0.5, from: p}); n--;
  }
  // горящая жидкость на полу (коктейль, пробитая бочка)
  if(puddle || strength >= 0.9){
    const fy = floorBelow(p);
    for(let i=0;i<(puddle?4:3);i++){
      const q = V(p.x + rnd(-1.2,1.2), fy + 0.02, p.z + rnd(-1.2,1.2));
      addFire(q, null, {I:0.8, fuel: rnd(10,18)});
    }
  }
}

let tickT = 0;
export function updateFire(dt, t){
  coolDown(dt);
  tickT += dt;
  const doTick = tickT >= 0.12;
  const TT = tickT; if(doTick) tickT = 0;
  let near = 0, nearP = null, nearD = 1e9;
  for(let i=FIRES.length-1;i>=0;i--){
    const f = FIRES[i];
    f.t += dt;
    // элемент под огнём уже сгорел — очаг опадает на пол и догорает там
    if(f.ref && !refAliveSafe(f.ref)){
      f.ref = null; f.free = true; f.fuel = Math.min(f.fuel, rnd(4,9));
      const fy = floorBelow(f.p); if(f.p.y - fy > 0.3){ spawnEmbers(f.p, 10); f.p.y = fy + 0.03; f.n.set(0,1,0); }
    }
    f.fuel -= dt;
    const want = f.fuel > 0 ? f.target : 0;
    f.I = clamp(f.I + (want > f.I ? 0.12 : -0.35)*dt, 0, 1);
    if(f.fuel <= 0 && f.I <= 0.01){ FIRES.splice(i,1); continue; }
    emit(f, dt, t);
    const d = f.p.distanceTo(camera.position);
    near += f.I * clamp(1 - d/14, 0, 1);
    if(d < nearD){ nearD = d; nearP = f.p; }
    if(!doTick) continue;
    // обугливание и жар вокруг очага
    const r = 0.35 + f.I*0.9;
    charSphere(f.p.clone().addScaledVector(V(0,1,0), 0.25*f.I), r, 0.07*f.I*TT*6, 0.4 + 0.6*f.I);
    if(f.ref){
      burnDamage(f.ref, (7 + 16*f.I)*TT, V(0,-1,0));
    }
    // распространение: вверх быстрее, в стороны медленнее
    f.spreadT -= TT*(0.4 + f.I);
    if(f.spreadT <= 0 && f.I > 0.45){
      f.spreadT = rnd(2.0, 4.5);
      const dir = V(rnd(-1,1), rnd(-0.3,1.6), rnd(-1,1)).normalize();
      const q = f.p.clone().addScaledVector(dir, rnd(0.45,1.0));
      const cand = query(q, 0.55, refFlammable);
      if(cand.length){
        const c = cand[Math.floor(Math.random()*cand.length)];
        let busy = false; for(const g of FIRES) if(g.p.distanceToSquared(c.pos) < 0.3) { busy = true; break; }
        if(!busy) addFire(c.pos, c.ref, {I:0.12, from: f.p});
      }
    }
  }
  if(doTick) flushDestruction();
  updateLights(t);
  SND.fire(clamp(near*0.6, 0, 1), nearP);
  if(HOOKS.fireNear) HOOKS.fireNear();
}
function refAliveSafe(ref){
  if(ref.t==='c') return ref.s.alive[ref.k] === 1;
  if(ref.t==='b') return !ref.b.dead;
  if(ref.t==='p') return !ref.p.dead;
  return false;
}
const _up = V(0,1,0);
function emit(f, dt, t){
  const I = f.I; if(I <= 0.01) return;
  // языки пламени: плотность и размер растут с силой огня
  const rate = (10 + 34*I) * (Q.dust >= 2000 ? 1 : 0.7);
  f._acc = (f._acc||0) + rate*dt;
  const base = f.p;
  while(f._acc >= 1){
    f._acc -= 1;
    const spread = 0.12 + 0.35*I;
    const p = V(base.x + rnd(-spread,spread), base.y + rnd(-0.1,0.25)*I, base.z + rnd(-spread,spread));
    if(!f.free) p.addScaledVector(f.n, rnd(0.02,0.12));
    FXS.flame.spawn({p, v:V(rnd(-0.2,0.2), rnd(0.9,1.9)*(0.6+I), rnd(-0.2,0.2)), life:rnd(0.5,1.0),
      s0:rnd(0.35,0.6)*(0.5+I), s1:rnd(0.08,0.18), rot:rnd(-0.3,0.3), spin:rnd(-1,1),
      col:[1, rnd(0.55,0.8), rnd(0.25,0.4)], a0:0.85, a1:0, drag:0.8, turb:1.2, fadeIn:0.08});
  }
  f._gacc = (f._gacc||0) + 3*dt;
  if(f._gacc >= 1){ f._gacc -= 1;
    FXS.flash.spawn({p: base.clone().add(V(0, 0.3*I, 0)).addScaledVector(f.n, 0.15), life:0.45, s0:1.0+1.6*I, s1:1.2+1.8*I,
      col:[1,0.45,0.12], a0:0.22*I, a1:0, fadeIn:0.15}); }
  f._sacc = (f._sacc||0) + (1.2 + 3.5*I)*dt;
  while(f._sacc >= 1){
    f._sacc -= 1;
    const p = V(base.x + rnd(-0.2,0.2), base.y + 0.6*I + 0.3, base.z + rnd(-0.2,0.2));
    const g = rnd(0.06, 0.16);
    FXS.smoke.spawn({p, v:V(rnd(-0.15,0.15), rnd(0.7,1.3), rnd(-0.15,0.15)), life:rnd(5,9),
      s0:0.35+0.4*I, s1:rnd(2.2,3.6), rot:rnd(0,6.28), spin:rnd(-0.2,0.2),
      col:[g,g*0.95,g*0.9], a0:0.42*(0.4+I), a1:0, drag:0.12, turb:0.35, fadeIn:0.6});
  }
  if(Math.random() < I*dt*6){
    FXS.ember.spawn({p: base.clone().add(V(rnd(-0.2,0.2), rnd(0,0.4), rnd(-0.2,0.2))),
      v:V(rnd(-0.6,0.6), rnd(1.2,3.2), rnd(-0.6,0.6)), life:rnd(1.2,2.8), s0:rnd(0.02,0.04), s1:0.01,
      col:[1,0.55,0.18], a0:1, a1:0, drag:0.4, turb:2.0, g:-0.3});
  }
}
function spawnEmbers(p, n){
  for(let i=0;i<n;i++) FXS.ember.spawn({p: p.clone(), v:V(rnd(-1.5,1.5), rnd(0.5,3), rnd(-1.5,1.5)), life:rnd(0.8,2),
    s0:0.035, s1:0.01, col:[1,0.5,0.15], a0:1, a1:0, g:-6, drag:0.3});
}
/** Свет от пламени: несколько источников на самые сильные очаги рядом с камерой. */
function updateLights(t){
  const cam = camera.position;
  // очаги кластеризуются: соседние огни делят один источник
  const ranked = FIRES.filter(f=>f.I>0.05).map(f=>({f, s: f.I/(1 + f.p.distanceTo(cam)*0.15)})).sort((a,b)=>b.s-a.s);
  const used = [];
  for(const r of ranked){
    if(used.length >= LIGHTS.length) break;
    if(used.some(u=>u.p.distanceToSquared(r.f.p) < 2.5)) { continue; }
    used.push(r.f);
  }
  LIGHTS.forEach((L,i)=>{
    const f = used[i];
    if(!f){ L.intensity = lerp(L.intensity, 0, 0.2); if(L.intensity < 0.01) L.position.y = -40; return; }
    L.position.copy(f.p).addScaledVector(f.n, 0.35); L.position.y += 0.35 + 0.3*f.I;
    const fl = 0.75 + 0.25*Math.sin(t*17 + i*3.1)*Math.sin(t*7.3 + i);
    L.intensity = (6 + 22*f.I) * fl;
    L.distance = 5 + 6*f.I;
  });
}
export function fireAt(p, r=0.8){ let s = 0; for(const f of FIRES){ const d = f.p.distanceTo(p); if(d < r) s += f.I*(1-d/r); } return s; }
