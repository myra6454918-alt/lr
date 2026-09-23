// Ядро: утилиты, профиль качества, рендерер, сцена, камера, небо, окружение.
import * as THREE from 'three';
export { THREE };
const $ = s => document.querySelector(s);
const clamp = (v,a,b)=> v<a?a:(v>b?b:v);
const lerp = (a,b,t)=> a+(b-a)*t;
const smoothstep = (a,b,x)=>{ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
let SEED = 20260920;
const srnd = ()=>{ SEED = (SEED*1664525 + 1013904223) >>> 0; return SEED/4294967296; };
const sr = (a,b)=> a + srnd()*(b-a);
const si = (a,b)=> Math.floor(sr(a,b+1));
const spick = arr => arr[Math.floor(srnd()*arr.length)];

/* ============================================================================
   УРОВНИ КАЧЕСТВА
   Карта должна открываться и на слабой машине. Профиль выбирается сам по
   числу ядер, памяти и строке GPU, но его всегда можно задать через ?q=.
============================================================================ */
const QPRESETS = {
  low: {
    pixelRatio:1.0, shadow:1024, shadowFar:120, ao:false, bloom:false, smaa:false,
    tex:0.5, dust:900, lights:3, shafts:0.35, props:0.55, debris:120,
    anisotropy:2, softShadow:false, cloth:0.45, target:45
  },
  med: {
    pixelRatio:1.25, shadow:2048, shadowFar:150, ao:false, bloom:true, smaa:true,
    tex:0.75, dust:2200, lights:5, shafts:0.7, props:0.8, debris:260,
    anisotropy:4, softShadow:true, cloth:0.7, target:50
  },
  high: {
    pixelRatio:1.5, shadow:3072, shadowFar:170, ao:true, bloom:true, smaa:true,
    tex:1.0, dust:4200, lights:6, shafts:1.0, props:1.0, debris:420,
    anisotropy:8, softShadow:true, cloth:1.0, target:55
  },
  ultra: {
    pixelRatio:1.75, shadow:4096, shadowFar:190, ao:true, bloom:true, smaa:true,
    tex:1.0, dust:6000, lights:8, shafts:1.0, props:1.0, debris:600,
    anisotropy:16, softShadow:true, cloth:1.0, target:58
  }
};
/** Грубая оценка класса машины. Строку GPU достаём одноразовым контекстом:
    программный рендерер (SwiftShader/llvmpipe) обязан получить профиль low. */
function autoQuality(){
  let gpu = '';
  try{
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if(dbg) gpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)||'');
    else if(gl) gpu = String(gl.getParameter(gl.RENDERER)||'');
  }catch(e){}
  const soft = /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(gpu);
  if(soft) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
  if(mobile || cores <= 4 || mem <= 4) return 'low';
  if(cores <= 8 || mem <= 8) return 'med';
  const strong = /rtx|radeon rx (6|7|9)|apple m[1-9]|arc a7/i.test(gpu);
  return strong ? 'ultra' : 'high';
}
const QPARAM = new URLSearchParams(location.search).get('q');
const QNAME = QPRESETS[QPARAM] ? QPARAM : autoQuality();
const Q = QPRESETS[QNAME];
/** Разрешение процедурных текстур подстраивается под профиль: на low карты
    вдвое меньше, а рисунок остаётся тем же. */
const TS = n => Math.max(128, Math.round(n*Q.tex/64)*64);

/* ============================================================================
   РЕНДЕРЕР
============================================================================ */
const renderer = new THREE.WebGLRenderer({antialias:false, powerPreference:'high-performance', stencil:false});
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = Q.softShadow ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
// Тень пересчитывается не каждый кадр, а только когда солнце заметно сдвинулось.
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth/innerHeight, 0.04, 400);

/** Купол неба. Градиент считается в шейдере от положения солнца, поэтому
    закат «поджигает» именно ту сторону горизонта, где садится солнце, и
    ночью сквозь проёмы кровли видно звёзды, а не чёрный фон. */
let SKY = null;
const skyUniforms = {
  uTop:     {value: new THREE.Color(0x7d9fc4)},
  uMid:     {value: new THREE.Color(0xc3d0de)},
  uBot:     {value: new THREE.Color(0x9a9186)},
  uSunDir:  {value: new THREE.Vector3(0,1,0)},
  uSunCol:  {value: new THREE.Color(0xfff2dc)},
  uSunSize: {value: 0.0016},
  uHaze:    {value: 0.35},
  uStars:   {value: 0.0},
  uMoonDir: {value: new THREE.Vector3(0,-1,0)},
  uMoon:    {value: 0.0}
};
function buildSky(){
  const mat = new THREE.ShaderMaterial({
    side:THREE.BackSide, fog:false, depthWrite:false, uniforms:skyUniforms,
    vertexShader:`
      varying vec3 vDir;
      void main(){ vDir = normalize(position);
        gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`
      uniform vec3 uTop,uMid,uBot,uSunCol,uSunDir,uMoonDir;
      uniform float uSunSize,uHaze,uStars,uMoon;
      varying vec3 vDir;
      // дешёвый хеш для звёздного поля: настоящая текстура тут не нужна
      float hash(vec3 p){ p = fract(p*0.3183099+vec3(0.71,0.113,0.419));
        p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(uMid, uTop, pow(clamp(h,0.0,1.0), 0.62))
                           : mix(uMid, uBot, pow(clamp(-h,0.0,1.0), 0.45));
        // зарево вокруг солнца: усиливается у горизонта, откуда и берётся закат
        float sd = max(dot(d, uSunDir), 0.0);
        float horizonBoost = 1.0 - smoothstep(0.0, 0.42, abs(uSunDir.y));
        col += uSunCol * pow(sd, 6.0) * (0.22 + 0.85*horizonBoost) * uHaze;
        col += uSunCol * pow(sd, 220.0) * 0.55;
        // диск солнца
        float disk = smoothstep(1.0-uSunSize, 1.0-uSunSize*0.35, sd);
        col = mix(col, uSunCol*2.4, disk * smoothstep(-0.10, 0.02, uSunDir.y));
        if(uStars > 0.001){
          vec3 sp = floor(d*260.0);
          float r = hash(sp);
          float star = smoothstep(0.9975, 0.99995, r) * smoothstep(-0.05, 0.25, h);
          col += vec3(0.85,0.90,1.0) * star * uStars * (0.6 + 0.4*hash(sp+7.0));
        }
        if(uMoon > 0.001){
          float md = max(dot(d, uMoonDir), 0.0);
          col += vec3(0.82,0.86,1.0) * pow(md, 900.0) * uMoon * 2.2;
          col += vec3(0.42,0.50,0.70) * pow(md, 9.0) * uMoon * 0.16;
        }
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 20), mat);
  dome.name='sky'; dome.frustumCulled = false;
  scene.add(dome);
  SKY = dome;
}
function cv(w,h){ const c=document.createElement('canvas'); c.width=w; c.height=h; return [c, c.getContext('2d',{willReadFrequently:true})]; }
function buildEnvironment(){
  const [c,x] = cv(256,128);
  // верх — свет из кровли, середина — стены ангара, низ — бетонный пол
  const g = x.createLinearGradient(0,0,0,128);
  g.addColorStop(0.00, '#cfd8e2');
  g.addColorStop(0.34, '#a8a49b');
  g.addColorStop(0.52, '#7d786f');
  g.addColorStop(0.72, '#6b665e');
  g.addColorStop(1.00, '#514c45');
  x.fillStyle=g; x.fillRect(0,0,256,128);
  // яркие пятна — имитация световых проёмов и ленточных окон
  for(let i=0;i<9;i++){
    const px=Math.random()*256, py=Math.random()*26;
    const rg=x.createRadialGradient(px,py,1,px,py,26);
    rg.addColorStop(0,'rgba(255,250,238,.85)'); rg.addColorStop(1,'rgba(255,250,238,0)');
    x.fillStyle=rg; x.fillRect(px-26,py-26,52,52);
  }
  for(let i=0;i<14;i++){
    const px=Math.random()*256, py=38+Math.random()*10;
    x.fillStyle='rgba(226,234,242,.55)';
    x.fillRect(px, py, 16, 5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose(); tex.dispose();
  scene.environment = env;
}


export const DEBUG = new URLSearchParams(location.search);
/** ?fast — облегчённые текстуры для автотестов и слабого железа. */
export const TEXK = DEBUG.has('fast') ? 0.12 : 1;
export { $, clamp, lerp, smoothstep, srnd, sr, si, spick, QPRESETS, QNAME, Q, TS,
         renderer, scene, camera, skyUniforms, buildSky, buildEnvironment };
export const rnd = (a,b)=> a + Math.random()*(b-a);
