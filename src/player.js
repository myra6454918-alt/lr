// Игрок: персонаж Bullet (капсула + шаг по ступеням), полёт-наблюдатель,
// здоровье, контузия, тряска камеры, покачивание, шаги по типу поверхности.
import { THREE, camera, clamp, lerp, rnd } from './engine.js';
import { makeCharacter, rayFirst, GRP, SURF_NAME, PH } from './physics.js';
import { SND } from './fx.js';

export const PL = {
  yaw: 0, pitch: 0, fly: false, hp: 100, alive: true, team: null, spawn: null,
  vel: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.6, 0), crouch: 0, sprint: false,
  shake: 0, recoil: 0, flash: 0, deaf: 0, bob: 0, stepAcc: 0, speed: 0, onGround: true,
  ads: 0, deadT: 0, char: null, flyPos: new THREE.Vector3(), damageFx: 0, lastSurf:'conc'
};
export const keys = {};
const EYE = 1.62, EYE_C = 1.05, HALF = 0.87;       // рост глаз и полувысота капсулы
let SENS = 0.0018;
export const INPUT = { locked:false, mouseDown:false, rmb:false, onFire:null, onKey:null };

export function initPlayer(canvas){
  PL.char = makeCharacter(new THREE.Vector3(0, 5, -20), 0.32, 1.1, 0.42);
  addEventListener('keydown', e=>{
    if(e.code === 'Tab') e.preventDefault();
    keys[e.code] = true;
    if(INPUT.onKey) INPUT.onKey(e.code, e);
    if(['Space','ControlLeft','AltLeft'].includes(e.code) && INPUT.locked) e.preventDefault();
  });
  addEventListener('keyup', e=>{ keys[e.code] = false; });
  addEventListener('blur', ()=>{ for(const k in keys) keys[k] = false; INPUT.mouseDown = false; INPUT.rmb = false; });
  document.addEventListener('pointerlockchange', ()=>{ INPUT.locked = document.pointerLockElement === canvas; if(INPUT.onLock) INPUT.onLock(INPUT.locked); });
  document.addEventListener('mousemove', e=>{
    if(!INPUT.locked) return;
    const k = SENS * (1 - PL.ads*0.45);
    PL.yaw -= e.movementX * k; PL.pitch = clamp(PL.pitch - e.movementY * k, -1.55, 1.55);
  });
  canvas.addEventListener('mousedown', e=>{ if(!INPUT.locked) return; if(e.button===0) INPUT.mouseDown = true; if(e.button===2) INPUT.rmb = true; });
  addEventListener('mouseup', e=>{ if(e.button===0) INPUT.mouseDown = false; if(e.button===2) INPUT.rmb = false; });
  canvas.addEventListener('contextmenu', e=> e.preventDefault());
}
/** Появление в точке: капсула ставится на пол, взгляд — в сторону поля. */
export function spawnAt(sp, faceYaw){
  PL.hp = 100; PL.alive = true; PL.deadT = 0; PL.vel.set(0,0,0); PL.fly = false;
  PL.char.enable(true);
  PL.char.warp(new THREE.Vector3(sp.x, 0.1 + HALF + 0.05, sp.z));
  PL.yaw = faceYaw; PL.pitch = -0.04;
  PL.eye.set(sp.x, EYE, sp.z);
}
export function setFly(on){
  if(on === PL.fly) return;
  PL.fly = on;
  if(on){ PL.flyPos.copy(camera.position); PL.char.enable(false); }
  else { PL.char.enable(true); PL.char.warp(new THREE.Vector3(camera.position.x, camera.position.y - EYE + HALF + 0.1, camera.position.z)); }
}
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3(), cpos = new THREE.Vector3();
const _e = new THREE.Euler(0,0,0,'YXZ');
export function updatePlayer(dt, t){
  PL.shake = Math.max(0, PL.shake - dt*1.6);
  PL.flash = Math.max(0, PL.flash - dt*0.5);
  PL.deaf = Math.max(0, PL.deaf - dt*0.25);
  PL.damageFx = Math.max(0, PL.damageFx - dt*1.5);
  PL.recoil *= Math.exp(-dt*9);
  PL.ads = lerp(PL.ads, INPUT.rmb && PL.alive && !PL.fly ? 1 : 0, 1 - Math.exp(-dt*14));
  fwd.set(-Math.sin(PL.yaw), 0, -Math.cos(PL.yaw));
  right.set(-fwd.z, 0, fwd.x);
  wish.set(0,0,0);
  if(PL.alive){
    if(keys.KeyW) wish.add(fwd); if(keys.KeyS) wish.sub(fwd);
    if(keys.KeyD) wish.add(right); if(keys.KeyA) wish.sub(right);
  }
  if(wish.lengthSq() > 0) wish.normalize();
  if(PL.fly){
    // свободный полёт: вперёд по взгляду, вверх/вниз клавишами
    const sp = (keys.ShiftLeft ? 22 : keys.AltLeft ? 2.5 : 8);
    const look = new THREE.Vector3(0,0,-1).applyEuler(_e.set(PL.pitch, PL.yaw, 0));
    const mv = new THREE.Vector3();
    if(keys.KeyW) mv.add(look); if(keys.KeyS) mv.sub(look);
    if(keys.KeyD) mv.add(right); if(keys.KeyA) mv.sub(right);
    if(keys.Space) mv.y += 1; if(keys.ControlLeft || keys.KeyC) mv.y -= 1;
    if(mv.lengthSq()>0) mv.normalize().multiplyScalar(sp);
    PL.vel.lerp(mv, 1 - Math.exp(-dt*6));
    PL.flyPos.addScaledVector(PL.vel, dt);
    PL.speed = PL.vel.length();
    camera.position.copy(PL.flyPos);
  } else {
    const crouching = (keys.ControlLeft || keys.KeyC) && PL.alive;
    PL.crouch = lerp(PL.crouch, crouching ? 1 : 0, 1 - Math.exp(-dt*10));
    PL.sprint = keys.ShiftLeft && !crouching && PL.ads < 0.3 && wish.dot(fwd) > 0.3;
    const maxS = crouching ? 2.1 : (PL.sprint ? 6.6 : 4.3) * (1 - PL.ads*0.4);
    const onG = PL.char.onGround();
    const accel = onG ? 12 : 2.5;
    const target = wish.clone().multiplyScalar(maxS);
    PL.vel.x = lerp(PL.vel.x, target.x, 1 - Math.exp(-dt*accel));
    PL.vel.z = lerp(PL.vel.z, target.z, 1 - Math.exp(-dt*accel));
    PL.char.setWalk(PL.vel.x/90, PL.vel.z/90);
    if(keys.Space && onG && PL.alive && !PL._jumpHeld){ PL.char.jump(); PL._jumpHeld = true; }
    if(!keys.Space) PL._jumpHeld = false;
    PL.char.pos(cpos);
    const feet = cpos.y - HALF;
    PL.speed = Math.hypot(PL.vel.x, PL.vel.z);
    PL.onGround = onG;
    // покачивание и шаги
    if(onG && PL.speed > 0.6){
      PL.bob += dt * (PL.sprint ? 13 : 9.5) * (crouching ? 0.7 : 1);
      PL.stepAcc += PL.speed*dt;
      const stride = PL.sprint ? 1.9 : 1.45;
      if(PL.stepAcc > stride){ PL.stepAcc = 0; footstep(cpos, crouching ? 0.4 : (PL.sprint ? 1.2 : 0.8)); }
    } else PL.bob = lerp(PL.bob, Math.round(PL.bob/Math.PI)*Math.PI, 1 - Math.exp(-dt*6));
    if(!PL._wasGround && onG && PL._fallV < -6) footstep(cpos, 1.4);
    PL._fallV = onG ? 0 : Math.min(PL._fallV||0, -1) - dt*19;
    PL._wasGround = onG;
    const eyeH = lerp(EYE, EYE_C, PL.crouch) - (PL.alive ? 0 : 1.25);
    const bobY = Math.abs(Math.sin(PL.bob))*0.045*(PL.speed/4.3) * (1-PL.ads*0.8);
    // сглаживание высоты камеры: ступени не дёргают взгляд
    const ty = feet + eyeH - bobY;
    PL.eye.x = cpos.x; PL.eye.z = cpos.z;
    PL.eye.y = Math.abs(ty - PL.eye.y) > 0.6 ? ty : lerp(PL.eye.y, ty, 1 - Math.exp(-dt*18));
    camera.position.copy(PL.eye);
    camera.position.addScaledVector(right, Math.cos(PL.bob*0.5)*0.02*(PL.speed/4.3)*(1-PL.ads));
    if(cpos.y < -10) { PL.hp = 0; }
  }
  // ориентация: взгляд + отдача + тряска
  const sh = PL.shake*PL.shake;
  const sx = (Math.sin(t*37.1)+Math.sin(t*23.7))*0.5*sh*0.05, sy = (Math.sin(t*31.3)+Math.cos(t*19.9))*0.5*sh*0.05;
  _e.set(PL.pitch + PL.recoil*0.9 + sx, PL.yaw + sy, (Math.sin(t*27.0))*sh*0.03 + (PL.alive?0:0.5), 'YXZ');
  camera.quaternion.setFromEuler(_e);
  const fovT = lerp(72, 50, PL.ads) + (PL.sprint ? 4 : 0);
  if(Math.abs(camera.fov - fovT) > 0.05){ camera.fov = lerp(camera.fov, fovT, 1 - Math.exp(-dt*12)); camera.updateProjectionMatrix(); }
}
function footstep(c, k){
  const h = rayFirst(c, new THREE.Vector3(c.x, c.y - 1.3, c.z), GRP.STATIC);
  let surf = 'conc';
  if(h){ if(h.idx >= 0){ const o = PH.owners[h.idx]; surf = o && (o.type==='sheet'||o.type==='beam'||o.type==='prop') ? 'wood' : 'conc'; }
         else surf = SURF_NAME[h.idx] || 'conc'; }
  PL.lastSurf = surf;
  SND.step(surf === 'sand' ? 'conc' : surf, k);
}
/** Урон игроку. */
export function hurt(dmg, kind){
  if(!PL.alive || PL.fly) return;
  PL.hp -= dmg; PL.damageFx = Math.min(1, PL.damageFx + dmg/40);
  if(PL.hp <= 0){ PL.hp = 0; PL.alive = false; PL.deadT = 0; PL.killedBy = kind; }
}
