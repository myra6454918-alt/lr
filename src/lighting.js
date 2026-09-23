// Свет: солнце/луна, заливки, световые столбы, пыль, суточный цикл, постобработка.
import { THREE, scene, camera, renderer, skyUniforms, Q, QNAME, sr, srnd, clamp, lerp, smoothstep } from './engine.js';
import { M } from './materials.js';
import { HW, HD, EAVE, SUNHOLES, LAMPS, setLampGlow, setNightGlow } from './hangar.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
let sun, moon, hemi, ambient, NIGHT=false;
const FILLS=[], LIGHT_POOL=[], SHAFTS=[];
let sunTarget;

function buildLights(){
  hemi = new THREE.HemisphereLight(0xaebfd0, 0x8a7e6c, 0.68); scene.add(hemi);
  ambient = new THREE.AmbientLight(0xdfe3e6, 0.16); scene.add(ambient);

  sun = new THREE.DirectionalLight(0xfff2dc, 5.4);
  sun.position.set(-46, 54, 30);
  sunTarget = new THREE.Object3D(); sunTarget.position.set(2,0,-4); scene.add(sunTarget);
  sun.target = sunTarget;
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  const c = sun.shadow.camera;
  c.left=-58; c.right=58; c.top=50; c.bottom=-50; c.near=1; c.far=Q.shadowFar;
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.034;
  scene.add(sun);

  // Луна: вторая тенеобразующая заливка, включается только ночью. Своя
  // карта теней ей не нужна — лунный свет мягкий и почти без контура.
  moon = new THREE.DirectionalLight(0x9db4e0, 0.0);
  moon.position.set(38, 46, -30); moon.target = sunTarget; scene.add(moon);

  // мягкие заполняющие от остекления (без теней — дёшево)
  const f1 = new THREE.DirectionalLight(0xc6d4e6, 0.5); f1.position.set(30,14,-26); scene.add(f1);
  const f2 = new THREE.DirectionalLight(0xbcc8d8, 0.34); f2.position.set(-30,13,26); scene.add(f2);
  const f3 = new THREE.DirectionalLight(0xe8e2d4, 0.28); f3.position.set(6,24,2);   scene.add(f3);
  // отражённый от бетонного пола свет — иначе низ кровли и фермы уходят в смолу
  const bounce = new THREE.DirectionalLight(0xd4cbba, 0.55);
  bounce.position.set(0,-20,0); scene.add(bounce);
  FILLS.push(f1,f2,f3,bounce);

  for(let i=0;i<Q.lights;i++){
    const L = new THREE.PointLight(0xe6e4dc, 0, 16, 2);
    L.position.set(0,-60,0); scene.add(L); LIGHT_POOL.push(L);
  }
}

/* --- Объёмные световые столбы из проёмов кровли (аддитивные конусы) --- */
const shaftMat = new THREE.ShaderMaterial({
  transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
  uniforms:{ uColor:{value:new THREE.Color(0xffe8c4)}, uOpacity:{value:0.055}, uTime:{value:0} },
  vertexShader:`
    varying vec3 vPos; varying vec2 vUv;
    void main(){ vUv=uv; vPos=position;
      gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader:`
    uniform vec3 uColor; uniform float uOpacity, uTime;
    varying vec3 vPos; varying vec2 vUv;
    void main(){
      // затухание к низу столба и к его краям
      float h = clamp(vUv.y, 0.0, 1.0);
      float fade = pow(1.0 - h, 2.1);
      // мягкие края: иначе конус читается как непрозрачная белая стена
      float edge = smoothstep(0.0, 0.46, vUv.x) * smoothstep(1.0, 0.54, vUv.x);
      edge = pow(edge, 1.6);
      float flick = 0.94 + 0.06*sin(uTime*0.6 + vPos.x*0.5);
      gl_FragColor = vec4(uColor, uOpacity*fade*edge*flick);
    }`
});
/** Столбы света из проёмов кровли. Геометрия строится единичной длины и
    разворачивается по солнцу каждый раз, когда оно сдвинулось: иначе
    к вечеру лучи продолжали бы падать отвесно, как в полдень. */
const SPOT_POOL = [];               // световые пятна на полу
const _shaftDown = new THREE.Vector3(0,-1,0);
function buildShafts(){
  // Столбы ставим у самых крупных проёмов: на слабом профиле их меньше,
  // но это именно те лучи, которые видно, а не случайная выборка.
  const keep = SUNHOLES.filter(h=>h.open)
    .sort((a,b)=> (b.w*b.d) - (a.w*a.d));
  const n = Math.max(1, Math.round(keep.length * Q.shafts));
  for(let i=0;i<Math.min(n, keep.length);i++){
    const h = keep[i];
    const r = Math.max(h.w, h.d);
    // конус единичной высоты: реальная длина задаётся масштабом по Y
    const g = new THREE.CylinderGeometry(r*0.55, r*0.86, 1, 12, 1, true);
    g.translate(0, -0.5, 0);        // вершина в начале координат — в проёме
    const m = new THREE.Mesh(g, shaftMat);
    m.position.set(h.x, h.y, h.z);
    m.renderOrder = 3;
    m.userData.baseOpacity = 0.055;
    m.userData.hole = h;
    m.userData.nomerge = true;
    scene.add(m); SHAFTS.push(m);
    // яркое пятно на полу под лучом
    const spot = new THREE.Mesh(new THREE.CircleGeometry(r*0.62, 16), SPOT_MAT);
    spot.rotation.x = -Math.PI/2; spot.position.set(h.x, 0.012, h.z);
    spot.renderOrder = 3; spot.userData.nomerge = true;
    scene.add(spot); SPOT_POOL.push({mesh:spot, hole:h, r});
  }
  updateShafts();
}
const SPOT_MAT = new THREE.MeshBasicMaterial({color:0xffeccd, transparent:true,
  opacity:0.055, blending:THREE.AdditiveBlending, depthWrite:false});
const _shaftQ = new THREE.Quaternion(), _shaftDir = new THREE.Vector3();
function updateShafts(){
  // Направление распространения света: от солнца вниз.
  _shaftDir.copy(SUN_DIR).negate();
  const down = Math.max(0.12, -_shaftDir.y);
  _shaftQ.setFromUnitVectors(_shaftDown, _shaftDir);
  for(const m of SHAFTS){
    const h = m.userData.hole; if(!h) continue;
    const len = clamp(h.y/down, 1, 46);
    m.quaternion.copy(_shaftQ);
    m.scale.set(1, len, 1);
  }
  for(const s of SPOT_POOL){
    const len = s.hole.y/down;
    // пятно уезжает по полу вслед за солнцем и растягивается к закату
    s.mesh.position.set(s.hole.x + _shaftDir.x*len, 0.012, s.hole.z + _shaftDir.z*len);
    const stretch = clamp(1/down, 1, 4.2);
    s.mesh.scale.set(1, stretch, 1);
    s.mesh.rotation.z = Math.atan2(_shaftDir.x, _shaftDir.z);
    const inside = Math.abs(s.mesh.position.x) < HW && Math.abs(s.mesh.position.z) < HD;
    s.mesh.visible = inside;
  }
}
/* --- Пыль в воздухе: точки, подсвеченные в лучах --- */
let dust;
function buildDust(){
  const N = Q.dust;
  const pos = new Float32Array(N*3), rndv = new Float32Array(N);
  for(let i=0;i<N;i++){
    pos[i*3]   = sr(-HW+1, HW-1);
    pos[i*3+1] = sr(0.2, EAVE-0.5);
    pos[i*3+2] = sr(-HD+1, HD-1);
    rndv[i] = srnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rndv,1));
  const m = new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
    uniforms:{ uTime:{value:0}, uSize:{value:1.15}, uOpacity:{value:0.5},
               uPixelRatio:{value:renderer.getPixelRatio()} },
    vertexShader:`
      attribute float aRnd; uniform float uTime,uSize,uPixelRatio;
      varying float vA;
      void main(){
        vec3 p = position;
        // медленный дрейф по воздуху
        p.x += sin(uTime*0.10 + aRnd*31.4)*0.55;
        p.y += sin(uTime*0.07 + aRnd*17.7)*0.35;
        p.z += cos(uTime*0.09 + aRnd*23.1)*0.55;
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        gl_Position = projectionMatrix*mv;
        gl_PointSize = clamp(uSize*uPixelRatio*(9.0/max(-mv.z,1.0)), 0.6, 3.2);
        // ближе к свету сверху — ярче
        vA = (0.30 + 0.70*aRnd) * smoothstep(0.0,3.0,p.y);
      }`,
    fragmentShader:`
      uniform float uOpacity; varying float vA;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.06, length(d));
        gl_FragColor = vec4(vec3(1.0,0.95,0.86), a*vA*uOpacity);
      }`
  });
  dust = new THREE.Points(g, m);
  dust.frustumCulled = false;
  scene.add(dust);
}
function updateLightPool(pos){
  if(!LAMPS.length) return;
  LAMPS.forEach(l => l.d = (l.pos.x-pos.x)**2 + (l.pos.z-pos.z)**2);
  const near = LAMPS.filter(l=>l.on && l.lit > 0.02).sort((a,b)=>a.d-b.d).slice(0, LIGHT_POOL.length);
  const power = lerp(5, 30, LAMP_LEVEL);
  near.forEach((l,i)=>{
    const L = LIGHT_POOL[i];
    L.position.copy(l.pos);
    L.intensity = power * l.lit * clamp(1 - Math.sqrt(l.d)/24, 0, 1);
  });
  for(let i=near.length;i<LIGHT_POOL.length;i++) LIGHT_POOL[i].intensity = 0;
}

/* ---------------------------------------------------------------------------
   СУТОЧНЫЙ ЦИКЛ
   Время идёт само: сцена открывается ясным днём, затем вечер, закат, сумерки,
   ночь с фонарями, рассвет — и снова день. Всё освещение (солнце, луна,
   небо, туман, лампы, экспозиция) — функции одного параметра t ∈ [0,1).
--------------------------------------------------------------------------- */
/** Ключевые кадры цикла. t — доля суток, 0.25 — полдень, 0.75 — полночь. */
const DAY_KEYS = [
  // t,    sunI, sunColor, hemiSky,  hemiGnd,  amb,  skyTop,   skyMid,   skyBot,   fogCol,   fogD,    exposure, lamp
  [0.00, 0.55, 0xffb489, 0x7d92b4, 0x6d6354, 0.16, 0x37527e, 0xd8a074, 0x7a6a5e, 0x8e8074, 0.0090, 1.22, 0.55], // рассвет
  [0.10, 3.60, 0xffe0b4, 0x9fb6d2, 0x8a7e6c, 0.17, 0x5b84b8, 0xbcc9d4, 0x9a9186, 0x9aa0a6, 0.0058, 1.08, 0.12], // раннее утро
  [0.25, 5.60, 0xfff4e2, 0xaebfd0, 0x8a7e6c, 0.18, 0x6f96c4, 0xc8d4e0, 0xa39a8c, 0xa2a8ad, 0.0044, 1.00, 0.00], // полдень
  [0.42, 4.60, 0xffe7c2, 0xa8bcd0, 0x8a7a64, 0.18, 0x6a8fbe, 0xc9d0d8, 0x9e9486, 0x9ea2a4, 0.0050, 1.04, 0.05], // день
  [0.52, 2.60, 0xffc184, 0x9aa8c0, 0x8a7458, 0.17, 0x50719e, 0xd9ab7a, 0x8d7c68, 0x9a8c7c, 0.0068, 1.14, 0.35], // вечер
  [0.60, 1.05, 0xff8a4e, 0x87799a, 0x7a5c44, 0.15, 0x3c5286, 0xe07a44, 0x7c5a48, 0x8e6a52, 0.0092, 1.26, 0.72], // закат
  [0.66, 0.26, 0xd2663c, 0x5d5f86, 0x53463c, 0.12, 0x26355e, 0x9a5442, 0x51413c, 0x5c4a44, 0.0112, 1.34, 0.92], // гражданские сумерки
  [0.72, 0.03, 0x50607e, 0x2c3350, 0x241f22, 0.07, 0x0d1430, 0x22294a, 0x1d1c22, 0x1a1e2c, 0.0128, 1.42, 1.00], // сумерки
  [0.80, 0.00, 0x28344e, 0x18203a, 0x14121a, 0.05, 0x050a1c, 0x0d1430, 0x121118, 0x0a0d16, 0.0138, 1.46, 1.00], // ночь
  [0.90, 0.00, 0x28344e, 0x1a2340, 0x14121a, 0.05, 0x060b1e, 0x101838, 0x131219, 0x0c0f18, 0.0134, 1.44, 1.00], // глубокая ночь
  [0.96, 0.22, 0x8a6a72, 0x3d4464, 0x322a2c, 0.10, 0x18224a, 0x4a4468, 0x2e2a2e, 0x2e3042, 0.0118, 1.36, 0.95], // предрассветные
  [1.00, 0.55, 0xffb489, 0x7d92b4, 0x6d6354, 0.16, 0x37527e, 0xd8a074, 0x7a6a5e, 0x8e8074, 0.0090, 1.22, 0.55]
];
const PHASE_NAMES = [
  [0.045,'РАССВЕТ'], [0.17,'УТРО'], [0.34,'ПОЛДЕНЬ'], [0.47,'ДЕНЬ'],
  [0.56,'ВЕЧЕР'], [0.635,'ЗАКАТ'], [0.70,'СУМЕРКИ'], [0.755,'НОЧЬ'],
  [0.935,'ГЛУБОКАЯ НОЧЬ'], [0.985,'ПРЕДРАССВЕТНЫЕ СУМЕРКИ'], [1.01,'РАССВЕТ']
];
/** Карта открывается днём, дальше время идёт вперёд: вечер → закат → ночь. */
let DAY_T = 0.26;
let DAY_SPEED = 1/300;          // полные сутки за 5 минут реального времени
let DAY_PAUSED = false;
let LAMP_LEVEL = 0;             // 0 — фонари выключены, 1 — горят в полную
const _kc = new THREE.Color(), _kc2 = new THREE.Color();
const SUN_DIR = new THREE.Vector3(0,1,0);
const MOON_DIR = new THREE.Vector3(0,-1,0);
let SUN_ELEV = 1;

/** Линейная выборка из таблицы ключей с интерполяцией цветов в sRGB. */
function sampleDay(t){
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while(i < DAY_KEYS.length-2 && DAY_KEYS[i+1][0] <= t) i++;
  const a = DAY_KEYS[i], b = DAY_KEYS[i+1];
  const k = clamp((t - a[0]) / Math.max(1e-6, b[0]-a[0]), 0, 1);
  // сглаживание перехода: линейный стык между ключами даёт заметный излом
  const s = k*k*(3-2*k);
  const mixCol = (ca, cb, out)=>{
    out.setHex(ca, THREE.SRGBColorSpace);
    _kc2.setHex(cb, THREE.SRGBColorSpace);
    return out.lerp(_kc2, s);
  };
  return {
    sunI: lerp(a[1], b[1], s),
    sunCol: mixCol(a[2], b[2], new THREE.Color()),
    hemiSky: mixCol(a[3], b[3], new THREE.Color()),
    hemiGnd: mixCol(a[4], b[4], new THREE.Color()),
    amb: lerp(a[5], b[5], s),
    skyTop: mixCol(a[6], b[6], new THREE.Color()),
    skyMid: mixCol(a[7], b[7], new THREE.Color()),
    skyBot: mixCol(a[8], b[8], new THREE.Color()),
    fogCol: mixCol(a[9], b[9], new THREE.Color()),
    fogD: lerp(a[10], b[10], s),
    exp: lerp(a[11], b[11], s),
    lamp: lerp(a[12], b[12], s)
  };
}
function phaseName(t){
  t = ((t % 1) + 1) % 1;
  for(const [lim, name] of PHASE_NAMES) if(t < lim) return name;
  return 'РАССВЕТ';
}
/** Часы и минуты условных суток: 0.25 — полдень, 0.75 — полночь. */
function dayClock(t){
  const hours = (((t % 1) + 1) % 1) * 24 + 6;   // t=0 соответствует 06:00
  const h = Math.floor(hours) % 24, m = Math.floor((hours % 1) * 60);
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}

let _lastShadowDir = new THREE.Vector3(9,9,9);
/** Пересчёт всей световой обстановки под текущее время суток. */
function applyDaylight(t){
  const k = sampleDay(t);
  // Солнце ходит по наклонной дуге: ось восход-закат развёрнута поперёк
  // конька, поэтому полосы света из проёмов кровли ползут по полу.
  // Светлое время занимает 0..DUSK, ночь — остаток суток, поэтому шкала
  // разбита на два участка: иначе солнце садилось бы уже в «вечер»,
  // когда по таблице ключей оно ещё должно светить.
  const DUSK = 0.66, NOON = 0.25;
  let elev, azim;
  if(t < DUSK){
    // u: 0 — восход, 0.5 — полдень, 1 — заход
    const u = t < NOON ? 0.5*(t/NOON) : 0.5 + 0.5*((t-NOON)/(DUSK-NOON));
    elev = Math.sin(Math.PI*u);
    azim = -Math.cos(Math.PI*u);
  } else {
    const v = (t - DUSK)/(1 - DUSK);
    elev = -0.92*Math.sin(Math.PI*v);
    azim = Math.cos(Math.PI*v);
  }
  SUN_ELEV = elev;
  SUN_DIR.set(azim*0.86, Math.max(elev, -1), -azim*0.34 - 0.22*elev).normalize();
  const R = 96;
  sun.position.copy(SUN_DIR).multiplyScalar(R).add(sunTarget.position);
  sun.color.copy(k.sunCol);
  sun.intensity = k.sunI;
  sun.visible = k.sunI > 0.004;
  sun.castShadow = sun.visible && elev > -0.02;

  // Луна противостоит солнцу и светит только когда солнце за горизонтом.
  MOON_DIR.copy(SUN_DIR).negate();
  const moonUp = clamp(MOON_DIR.y, 0, 1);
  const nightK = smoothstep(0.06, -0.14, elev);          // 0 днём, 1 ночью
  moon.position.copy(MOON_DIR).multiplyScalar(R).add(sunTarget.position);
  moon.intensity = 0.34 * nightK * smoothstep(0.0, 0.35, moonUp);
  moon.visible = moon.intensity > 0.004;

  hemi.color.copy(k.hemiSky); hemi.groundColor.copy(k.hemiGnd);
  hemi.intensity = lerp(0.70, 0.17, nightK);
  ambient.intensity = k.amb;
  const fillBase = [0.50, 0.34, 0.28, 0.55];
  FILLS.forEach((f,i)=> f.intensity = fillBase[i] * lerp(1.0, 0.06, nightK));

  // небо
  skyUniforms.uTop.value.copy(k.skyTop);
  skyUniforms.uMid.value.copy(k.skyMid);
  skyUniforms.uBot.value.copy(k.skyBot);
  skyUniforms.uSunDir.value.copy(SUN_DIR);
  skyUniforms.uSunCol.value.copy(k.sunCol);
  skyUniforms.uHaze.value = lerp(0.30, 1.0, smoothstep(0.35, 0.0, Math.abs(elev)));
  skyUniforms.uStars.value = smoothstep(0.0, 0.9, nightK);
  skyUniforms.uMoonDir.value.copy(MOON_DIR);
  skyUniforms.uMoon.value = nightK * smoothstep(-0.05, 0.3, MOON_DIR.y);

  scene.fog.color.copy(k.fogCol);
  scene.fog.density = k.fogD;
  scene.background = k.fogCol;
  scene.environmentIntensity = lerp(1.0, 0.10, nightK);
  renderer.toneMappingExposure = k.exp;

  // Стёкла темнеют к ночи, но подсвечиваются изнутри, когда горят фонари.
  M.glass.color.copy(k.skyMid).lerp(_kc.setHex(0xc4cfd6), 1-nightK*0.86);
  M.glass.emissiveIntensity = lerp(0.42, 0.12, nightK);

  // Столбы света и пылинки живут только при солнце.
  const shaftK = clamp(k.sunI/4.2, 0, 1) * smoothstep(-0.02, 0.22, elev);
  const shaftsOn = shaftK > 0.02;
  shaftMat.uniforms.uOpacity.value = 0.058 * shaftK;
  SPOT_MAT.opacity = 0.075 * shaftK;
  for(const s of SHAFTS) s.visible = shaftsOn;
  if(shaftsOn) updateShafts();
  else for(const s of SPOT_POOL) s.mesh.visible = false;
  if(dust) dust.material.uniforms.uOpacity.value = lerp(0.44, 0.09, nightK);

  LAMP_LEVEL = k.lamp;
  setLampGlow(k.lamp);
  setNightGlow(k.lamp);
  NIGHT = nightK > 0.5;

  // Ночью лампы должны «цвести», днём ореол только пачкает картинку.
  if(bloomPass){
    bloomPass.strength  = lerp(0.24, 0.62, k.lamp);
    bloomPass.threshold = lerp(0.98, 0.62, k.lamp);
  }
  // Холодные тени днём, тёплые от натриевых ламп ночью.
  if(gradePass){
    gradePass.uniforms.uShadowTint.value.setRGB(
      lerp(0.78, 0.62, nightK), lerp(0.84, 0.70, nightK), lerp(0.98, 1.02, nightK));
    gradePass.uniforms.uHighTint.value.setRGB(
      lerp(1.06, 1.12, nightK), lerp(1.00, 0.96, nightK), lerp(0.90, 0.80, nightK));
    gradePass.uniforms.uVig.value = lerp(0.18, 0.34, nightK);
    gradePass.uniforms.uSat.value = lerp(1.04, 0.92, nightK);
  }

  // Карта теней перерисовывается, когда солнце заметно ушло: на слабой
  // машине ежекадровый проход теней стоит дороже всей остальной сцены.
  if(renderer.shadowMap.enabled && SUN_DIR.distanceToSquared(_lastShadowDir) > 2e-5){
    renderer.shadowMap.needsUpdate = true;
    _lastShadowDir.copy(SUN_DIR);
  }
}
/** Совместимость с прежним переключателем: прыжок на полдень или полночь. */
function setNight(on){ DAY_T = on ? 0.82 : 0.25; applyDaylight(DAY_T); }

const GradeShader = {
  uniforms:{
    tDiffuse:{value:null}, uVig:{value:0.18}, uSat:{value:1.04},
    uShadowTint:{value:new THREE.Color(0.78,0.84,0.98)},   // холодные тени
    uHighTint:{value:new THREE.Color(1.06,1.00,0.90)},     // тёплые света
    uLift:{value:0.016}, uContrast:{value:1.12}, uTemp:{value:0.0}
  },
  vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader:`
    uniform sampler2D tDiffuse;
    uniform float uVig,uSat,uLift,uContrast,uTemp;
    uniform vec3 uShadowTint, uHighTint;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = max(c.rgb, 0.0);

      // подъём чёрного: «плёночный» чёрный вместо провала в ноль
      col = col + uLift*(1.0 - col);

      // S-кривая контраста вокруг средней точки
      col = clamp((col - 0.5)*uContrast + 0.5, 0.0, 1.0);

      // Раздельная тонировка с сохранением яркости: тени холоднее, света теплее,
      // но общая экспозиция не падает (иначе картинка уходит в мутную оливку).
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      vec3 tint = mix(uShadowTint, uHighTint, smoothstep(0.06, 0.70, l));
      tint /= max(dot(tint, vec3(0.2126,0.7152,0.0722)), 1e-4);
      col *= mix(vec3(1.0), tint, 0.30);

      col = mix(vec3(dot(col, vec3(0.2126,0.7152,0.0722))), col, uSat);

      // мягкая широкая виньетка
      vec2 d = vUv - 0.5;
      col *= clamp(1.0 - uVig*dot(d,d)*1.9, 0.0, 1.0);

      gl_FragColor = vec4(col, c.a);
    }`
};
let composer, bloomPass, gradePass, smaaPass, aoPass;
function buildComposer(){
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Ambient occlusion: без контактных теней стыки стен/пола выглядят плоско.
  // Проход дорогой, поэтому на слабых профилях его заменяет запечённый AO
  // из карт высот — он уже есть у всех основных материалов.
  if(Q.ao){
    aoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
    aoPass.output = GTAOPass.OUTPUT.Default;
    aoPass.updateGtaoMaterial({
      radius: 0.42, distanceExponent: 1.6, thickness: 0.6,
      scale: 1.1, samples: QNAME==='ultra' ? 16 : 10, screenSpaceRadius: false
    });
    aoPass.updatePdMaterial({ lumaPhi: 8, depthPhi: 2.2, normalPhi: 3.6, radius: 4, samples: 8 });
    aoPass.blendIntensity = 1.0;
    composer.addPass(aoPass);
  }
  if(Q.bloom){
    // Ночью ореол вокруг ламп — главный носитель настроения, поэтому
    // порог ниже дневного и подстраивается в applyDaylight.
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight), 0.28, 0.85, 0.98);
    composer.addPass(bloomPass);
  }
  gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);
  if(Q.smaa){
    smaaPass = new SMAAPass(innerWidth*renderer.getPixelRatio(), innerHeight*renderer.getPixelRatio());
    composer.addPass(smaaPass);
  }
  composer.addPass(new OutputPass());
}

const DAY = {
  get t(){ return DAY_T; }, set t(v){ DAY_T = ((v%1)+1)%1; },
  get speed(){ return DAY_SPEED; }, set speed(v){ DAY_SPEED = v; },
  get paused(){ return DAY_PAUSED; }, set paused(v){ DAY_PAUSED = v; },
  get lamp(){ return LAMP_LEVEL; }, get night(){ return NIGHT; }, get elev(){ return SUN_ELEV; }
};
export { buildLights, buildShafts, buildDust, applyDaylight, setNight, phaseName, dayClock, DAY,
         shaftMat, SUN_DIR, buildComposer, updateLightPool, LIGHT_POOL, FILLS,
         getComposer, getPasses, dust as dustRef, getDust };
function getComposer(){ return composer; }
function getPasses(){ return {bloomPass, gradePass, smaaPass, aoPass}; }
function getDust(){ return dust; }
