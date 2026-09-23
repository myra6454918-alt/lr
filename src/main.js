// Точка входа: сборка карты, физика, интерфейс выбора команды, игровой цикл.
import { THREE, $, Q, QNAME, QPRESETS, renderer, scene, camera, buildSky, buildEnvironment, DEBUG, clamp, lerp } from './engine.js';
import { buildAllMaterials, BURN_U, M } from './materials.js';
import { flushBuckets, bakeScene, buildGrid, COLLIDERS, ensureColor } from './builder.js';
import * as H from './hangar.js';
import * as L from './lighting.js';
import { buildHouse, INTERIOR, F2 } from './house.js';
import { buildLayout, TEAMS, TEAM_LIGHTS, GATES, TEAM_SPOTS } from './layout.js';
import { initPhysics, buildStaticWorld, stepPhysics, PH, addDynamic, GRP, rayFirst } from './physics.js';
import { initDestructiblePhysics, registerGlass, HOOKS, DEST, flushDestruction, explode, resetDebrisBudget } from './destruction.js';
import { initFX, updateFX, FXS, SND, FXU } from './fx.js';
import { initFire, updateFire, FIRES, fireAt, ignite } from './fire.js';
import { initPlayer, updatePlayer, PL, INPUT, spawnAt, setFly, keys, hurt } from './player.js';
import { initWeapons, updateWeapons, weaponKey, WPN, onContact, playerBlast, grenadeExplode } from './weapons.js';
import { buildFlags, updateWind, WIND, drawMinimap, spawnFromClick, FLAGS } from './teams.js';
import { DYN_PROPS } from './props2.js';
import { emblemDataURL } from './textures.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';

window.__BGU = BGU;
const frame = ()=> new Promise(r=> requestAnimationFrame(()=> setTimeout(r, 0)));
const status = t => { const el = $('#g_status'); if(el) el.textContent = t; };
const STATE = { team:'ALPHA', spawn:null, playing:false, started:false, menu:true, fps:0 };

async function build(){
  scene.fog = new THREE.FogExp2(0x9aa0a6, 0.0048);
  scene.background = new THREE.Color(0x14151a);
  scene.add(camera);
  status('Небо и окружение…'); await frame();
  buildSky(); buildEnvironment();
  status('Процедурные текстуры: OSB, бетон, металл…'); await frame();
  buildAllMaterials();
  L.buildLights();
  initFX();
  status('Ангар…'); await frame();
  H.buildHangar(); H.buildRoof(); H.buildLamps(); H.buildServices(); H.buildNightLighting();
  status('Шут-хаус: каркас, обшивка, лестницы…'); await frame();
  buildHouse();
  status('Базы ALPHA / DELTA, укрытия, техника…'); await frame();
  buildLayout();
  status('Запекание геометрии…'); await frame();
  flushBuckets();
  L.buildShafts(); L.buildDust();
  const baked = bakeScene();
  scene.traverse(o=>{ if(o.isMesh && o.userData.glass && !o.userData.glassReg){ o.userData.glassReg = true; } });
  for(const o of collectGlass()) registerGlass(o, {hp:1});
  scene.traverse(o=>{ if(o.isMesh) ensureColor(o); });
  buildGrid();
  status('Физика Bullet (ammo.js)…'); await frame();
  await initPhysics();
  const nStatic = buildStaticWorld();
  initDestructiblePhysics();
  for(const d of DYN_PROPS){
    const rec = addDynamic(d.mesh, {shape:d.shape, size:d.size, mass:d.mass, surf:d.surf, friction:d.friction, restitution:d.restitution,
      group:GRP.DYN, life:1e9, keep:true, linDamp:0.05, angDamp:0.3});
    rec.body.setActivationState(2);      // спит до первого удара
  }
  buildFlags();
  initPlayer(renderer.domElement);
  initFire();
  initWeapons();
  HOOKS.playerBlast = (p, R, P)=>{ playerBlast(p, R, P); pushLamps(p, R*2.5, P); };
  PH.onContact = onContact;
  L.buildComposer();
  L.applyDaylight(L.DAY.t);
  renderer.shadowMap.needsUpdate = true;
  // стартовый вид: над картой, на здание
  camera.position.set(-24, 7.5, -22); camera.lookAt(0, 2, 0);
  PL.yaw = Math.atan2(24, 22) + Math.PI; PL.pitch = -0.2;
  PL.flyPos.copy(camera.position); PL.fly = true; PL.char.enable(false);
  window.ANGAR = api({baked, nStatic});
  setupUI();
  status('');
  if(!DEBUG.has('norun')) loop();
}
function collectGlass(){
  const out = [];
  scene.traverse(o=>{ if(o.isMesh && o.userData.glass && !DEST.glass.some(g=>g.mesh===o)) out.push(o); });
  return out;
}

/* ---------- подвесные лампы: маятник + свет из пула ---------- */
const LAMP_LIGHTS = [];
function initLampLights(){
  const n = Math.max(2, Math.min(5, Q.lights - 1));
  for(let i=0;i<n;i++){ const l = new THREE.PointLight(0xffd9a0, 0, 7.5, 1.6); l.position.set(0,-30,0); scene.add(l); LAMP_LIGHTS.push(l); }
}
function pushLamps(p, R, P){
  for(const l of INTERIOR){
    const d = l.pos.distanceTo(p); if(d > R) continue;
    const k = (1 - d/R)*P*2.2;
    l.vx += (l.x - p.x)/(d+0.5)*k; l.vz += (l.z - p.z)/(d+0.5)*k;
    l.flick = 1.2*(1-d/R);
  }
}
function updateLamps(dt, t){
  for(const l of INTERIOR){
    l.vx += (-9.81/l.len*Math.sin(l.ax) + WIND.vec.x*0.004*Math.sin(t*0.7+l.x))*dt;
    l.vz += (-9.81/l.len*Math.sin(l.az) + WIND.vec.z*0.004*Math.cos(t*0.6+l.z))*dt;
    l.vx *= Math.exp(-dt*0.35); l.vz *= Math.exp(-dt*0.35);
    l.ax = clamp(l.ax + l.vx*dt, -0.9, 0.9); l.az = clamp(l.az + l.vz*dt, -0.9, 0.9);
    const ox = Math.sin(l.ax)*l.len, oz = Math.sin(l.az)*l.len, oy = l.len*(1 - Math.cos(l.ax)*Math.cos(l.az));
    l.shade.position.set(l.x + ox, l.top - l.len + oy, l.z + oz);
    l.bulb.position.set(l.x + ox*1.05, l.top - l.len + oy - 0.06, l.z + oz*1.05);
    l.cord.position.set(l.x + ox/2, l.top - l.len/2 + oy/2, l.z + oz/2);
    l.cord.rotation.set(l.az*1, 0, -l.ax*1);
    l.shade.rotation.set(l.az, 0, -l.ax);
    l.pos.copy(l.bulb.position);
    l.flick = Math.max(0, (l.flick||0) - dt);
  }
  const cam = camera.position;
  const near = INTERIOR.map(l=>({l, d: l.pos.distanceToSquared(cam)})).sort((a,b)=>a.d-b.d);
  LAMP_LIGHTS.forEach((L_,i)=>{
    const e = near[i]; if(!e || e.d > 400){ L_.intensity = 0; return; }
    L_.position.copy(e.l.pos).add(new THREE.Vector3(0,-0.08,0));
    const fl = e.l.flick > 0 ? (Math.random() < 0.5 ? 0.1 : 1) : 1;
    L_.intensity = 6.5 * fl * clamp(1 - Math.sqrt(e.d)/20, 0, 1);
  });
}

/* ---------- цикл ---------- */
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fpsT = 0, shadowTick = 0;
function step(dt){
  const t = performance.now()/1000;
  resetDebrisBudget();
  updateWind(t);
  if(PH.ready) stepPhysics(dt, WIND.vec);
  updatePlayer(dt, t);
  updateWeapons(dt, t);
  updateFire(dt, t);
  flushDestruction();
  updateFX(dt, t);
  updateLamps(dt, t);
  // урон от огня и смерть
  if(PL.alive && !PL.fly){
    const feet = PL.eye.clone(); feet.y -= 1.2;
    const f = fireAt(feet, 0.9);
    if(f > 0.05) hurt(f*22*dt, 'fire');
    if(PL.hp < 100 && PL.hp > 0) PL.hp = Math.min(100, PL.hp + dt*2.5);
  }
  if(!PL.alive && STATE.playing){
    PL.deadT += dt;
    if(PL.deadT > 2.2 && !STATE.menu){ document.exitPointerLock(); openMenu('dead'); }
  }
  if(!L.DAY.paused){ L.DAY.t = L.DAY.t + dt*L.DAY.speed; L.applyDaylight(L.DAY.t); }
  L.shaftMat.uniforms.uTime.value = t;
  const dust = L.getDust(); if(dust) dust.material.uniforms.uTime.value = t;
  H.updateFlicker(t, L.DAY.lamp);
  L.updateLightPool(camera.position);
  BURN_U.uTime.value = t;
  // дневной свет в щели ворот и прожекторы баз следуют времени суток
  const sunK = clamp(L.DAY.elev*3 + 0.15, 0, 1);
  for(const g of GATES){ g.plane.material.color.setRGB(lerp(0.03,1,sunK), lerp(0.04,0.96,sunK), lerp(0.08,0.9,sunK)); g.beam.intensity = 30*sunK; }
  for(const sp of TEAM_SPOTS) sp.intensity = 40*L.DAY.lamp;
  // дым освещён тем же светом, что и сцена: ночью он не светится сам
  const k = clamp(0.25 + L.DAY.lamp*0 + (1 - L.DAY.lamp)*0.75, 0.22, 1);
  FXU.uAmb.value.setRGB(k, k*0.98, k*0.95);
  // тени: статика — по сдвигу солнца, подвижные тела — несколько раз в секунду
  shadowTick++;
  const active = PH.dyn.some(r=> r.body.isActive() && !r.keep) || FIRES.length || FLAGS.length;
  if(active && shadowTick % (Q.lights >= 6 ? 2 : 4) === 0) renderer.shadowMap.needsUpdate = true;
  SND.listener(); SND.ambienceTick(WIND.speed);
  if(SND.ok && SND.lp){ SND.lp.frequency.setTargetAtTime(lerp(20000, 500, PL.deaf), SND.ctx.currentTime, 0.1); }
  updateHUD(dt);
}
function loop(){
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  step(dt);
  L.getComposer().render();
  fpsAcc += 1/Math.max(dt,1e-4); fpsN++; fpsT += dt;
  if(fpsT > 0.5){
    STATE.fps = fpsAcc/fpsN;
    const el = $('#fps');
    if(el.style.display !== 'none') el.textContent = `${STATE.fps.toFixed(0)} fps · ${renderer.info.render.calls} calls · ${(renderer.info.render.triangles/1000).toFixed(0)}k tris · ${QNAME}`
      + ` · тел ${PH.dyn.length} · очагов ${FIRES.length} · разрушено ${DEST.broken} · ${L.dayClock(L.DAY.t)} ${L.phaseName(L.DAY.t)}`
      + ` · ${camera.position.x.toFixed(1)},${camera.position.y.toFixed(1)},${camera.position.z.toFixed(1)}`;
    fpsAcc = 0; fpsN = 0; fpsT = 0;
  }
}
addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  const c = L.getComposer(); if(c) c.setSize(innerWidth, innerHeight);
  const p = L.getPasses(); if(p.aoPass) p.aoPass.setSize(innerWidth, innerHeight);
  if(p.smaaPass) p.smaaPass.setSize(innerWidth*renderer.getPixelRatio(), innerHeight*renderer.getPixelRatio());
});

/* ============================================================================
   ИНТЕРФЕЙС: выбор команды и точки, пауза, HUD
============================================================================ */
function setupUI(){
  initLampLights();
  $('#g_load').style.display = 'none';
  $('#menu').style.display = 'flex';
  $('#q_name').textContent = QNAME;
  for(const t of ['ALPHA','DELTA']) $(`#team_${t} img`).src = emblemDataURL(t, 160);
  $('#hud_emblem').src = emblemDataURL(STATE.team, 64);
  const selTeam = t=>{
    STATE.team = t; STATE.spawn = TEAMS[t].spawns[0];
    for(const k of ['ALPHA','DELTA']) $(`#team_${k}`).classList.toggle('sel', k===t);
    document.body.dataset.team = t;
    renderMap();
  };
  const renderMap = ()=>{
    drawMinimap($('#minimap'), STATE.team, STATE.spawn, STATE.playing ? {x:camera.position.x, z:camera.position.z, yaw:PL.yaw} : null);
    const list = $('#spawns'); list.innerHTML = '';
    for(const sp of TEAMS[STATE.team].spawns){
      const b = document.createElement('button');
      b.className = 'sp' + (STATE.spawn && STATE.spawn.id === sp.id ? ' sel' : '');
      b.innerHTML = `<b>${sp.id}</b> ${sp.name}`;
      b.onclick = ()=>{ STATE.spawn = sp; renderMap(); };
      list.appendChild(b);
    }
  };
  STATE.renderMap = renderMap;
  $('#team_ALPHA').onclick = ()=> selTeam('ALPHA');
  $('#team_DELTA').onclick = ()=> selTeam('DELTA');
  $('#minimap').onclick = e=>{
    const r = e.target.getBoundingClientRect();
    const sx = e.target.width/r.width;
    const sp = spawnFromClick(STATE.team, (e.clientX-r.left)*sx, (e.clientY-r.top)*sx);
    if(sp){ STATE.spawn = sp; renderMap(); }
  };
  $('#go').onclick = ()=> deploy();
  $('#spectate').onclick = ()=> spectate();
  $('#resume').onclick = ()=> { closeMenu(); renderer.domElement.requestPointerLock(); };
  selTeam('ALPHA');
  INPUT.onLock = locked=>{
    if(locked){ closeMenu(); }
    else if(STATE.playing && !STATE.menu){ openMenu('pause'); }
  };
  INPUT.onKey = (code, e)=>{
    if(code === 'F3'){ e.preventDefault(); const el = $('#fps'); el.style.display = el.style.display === 'none' ? 'block' : 'none'; }
    if(!INPUT.locked) return;
    weaponKey(code);
    if(code === 'KeyF'){ setFly(!PL.fly); }
    if(code === 'KeyM'){ document.exitPointerLock(); openMenu('pause'); }
    if(code === 'KeyN'){ L.DAY.t = nextPhase(L.DAY.t); L.applyDaylight(L.DAY.t); renderer.shadowMap.needsUpdate = true; }
    if(code === 'KeyP'){ L.DAY.paused = !L.DAY.paused; }
    if(code === 'BracketRight'){ L.DAY.speed *= 2; }
    if(code === 'BracketLeft'){ L.DAY.speed /= 2; }
    if(code === 'KeyH'){ $('#hints').classList.toggle('hide'); }
  };
}
function nextPhase(t){
  const stops = [0.02, 0.25, 0.52, 0.61, 0.70, 0.82, 0.97];
  for(const s of stops) if(s > t + 0.01) return s;
  return stops[0] + 1;
}
function deploy(){
  SND.init(); SND.resume();
  const T = TEAMS[STATE.team], sp = STATE.spawn || T.spawns[0];
  PL.team = STATE.team; PL.spawn = sp;
  spawnAt(sp, T.side < 0 ? -Math.PI/2 : Math.PI/2);
  WPN.mag = WPN.magMax; WPN.reloadT = 0;
  $('#hud_emblem').src = emblemDataURL(STATE.team, 64);
  $('#hud_team').textContent = `${STATE.team} · ${sp.id} ${sp.name}`;
  STATE.playing = true; STATE.started = true;
  closeMenu();
  renderer.domElement.requestPointerLock();
}
function spectate(){
  SND.init(); SND.resume();
  STATE.playing = true; setFly(true);
  closeMenu(); renderer.domElement.requestPointerLock();
}
function openMenu(mode){
  STATE.menu = true;
  $('#menu').style.display = 'flex'; $('#menu').dataset.mode = mode;
  $('#resume').style.display = (mode === 'pause' && STATE.started && PL.alive) ? 'inline-block' : 'none';
  $('#menu_title').textContent = mode === 'dead' ? 'ВЫ ВЫБЫЛИ' : (mode === 'pause' ? 'ПАУЗА' : 'ANGAR-07');
  $('#hud').style.display = 'none';
  if(STATE.renderMap) STATE.renderMap();
}
function closeMenu(){ STATE.menu = false; $('#menu').style.display = 'none'; $('#hud').style.display = 'block'; }
let hudT = 0;
function updateHUD(dt){
  hudT += dt; if(hudT < 0.05) return; hudT = 0;
  $('#hp_bar').style.width = PL.hp + '%';
  $('#hp_num').textContent = Math.ceil(PL.hp);
  $('#ammo').textContent = WPN.reloadT > 0 ? 'ПЕРЕЗАРЯДКА' : `${WPN.mag} / ∞`;
  $('#nades').textContent = `G ×${Math.floor(WPN.frags)}   T ×${Math.floor(WPN.fire)}`;
  $('#dmg').style.opacity = Math.min(1, PL.damageFx*0.9 + (PL.hp < 35 ? 0.25 : 0));
  $('#cross').style.opacity = PL.fly || !PL.alive ? 0 : (1 - PL.ads*0.85);
  const spread = 8 + Math.min(PL.speed, 6)*2.5 + WPN.kick*6;
  $('#cross').style.setProperty('--g', spread + 'px');
  $('#clock').textContent = `${L.dayClock(L.DAY.t)} · ${L.phaseName(L.DAY.t)}${PL.fly ? ' · НАБЛЮДАТЕЛЬ' : ''}`;
  $('#dead').style.opacity = PL.alive ? 0 : 1;
  $('#concuss').style.opacity = PL.deaf*0.7;
}

/* ---------- отладочный API (проверки из консоли и автотестов) ---------- */
function api(stats){
  return {
    THREE, scene, camera, renderer, PH, DEST, FIRES, PL, WPN, TEAMS, COLLIDERS, stats, keys, INPUT,
    step:(dt=1/60, n=1)=>{ for(let i=0;i<n;i++) step(dt); },
    render:()=> L.getComposer().render(),
    view:(x,y,z, lx,ly,lz)=>{ WPN.viewmodel.visible = false; PL.fly = true; PL.char.enable(false); PL.flyPos.set(x,y,z); camera.position.set(x,y,z);
      const d = new THREE.Vector3(lx-x, ly-y, lz-z).normalize(); PL.yaw = Math.atan2(-d.x, -d.z); PL.pitch = Math.asin(d.y);
      updatePlayer(0, 0); },
    walkTo:(x,z)=>{ setFly(false); PL.char.warp(new THREE.Vector3(x, 1.2, z)); },
    deploy:(team='ALPHA', id)=>{ STATE.team = team; STATE.spawn = TEAMS[team].spawns.find(s=>s.id===id) || TEAMS[team].spawns[0]; deploy(); },
    shoot:()=>{ INPUT.locked = true; WPN.cool = 0; INPUT.mouseDown = true; updateWeapons(0.001, 0); INPUT.mouseDown = false; },
    grenade:(x,y,z)=> grenadeExplode(new THREE.Vector3(x,y,z), 1),
    throw:(code='KeyG')=> weaponKey(code),
    fire:(x,y,z,s=1)=> ignite(new THREE.Vector3(x,y,z), s, 1.5, s>=0.9),
    time:(t)=>{ L.DAY.t = t; L.applyDaylight(t); renderer.shadowMap.needsUpdate = true; },
    pause:(v=true)=>{ L.DAY.paused = v; },
    rayDown:(x,z)=> rayFirst(new THREE.Vector3(x, 20, z), new THREE.Vector3(x, -1, z), GRP.STATIC)
  };
}

build().catch(err=>{
  console.error(err);
  $('#g_load').innerHTML = '<p style="color:#d9736b">Ошибка: ' + String(err && err.message || err) + '</p>';
});
