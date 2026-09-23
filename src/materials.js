// Материалы: PBR-материалы из процедурных карт + шейдер обугливания дерева.
import { THREE, TS, Q, lerp } from './engine.js';
import { T, heightToNormal, heightToAO, osbMaps, concreteMaps, lumberMaps, corrugatedMaps, steelMaps,
         panelMaps, hazardMaps, dirtyGlassMaps, flagTex, helipadTex, parkingTex, teamFlagTex,
         decalAtlas, craterMaps, flameTex, smokeTex, glowTex, gratingMaps, camoCanvas, texOf } from './textures.js';
const MAPS = {}, M = {};
function buildMaterials(){
  const mk = (maps, rep, normScale, opts={}) => {
    const albedo = T(maps.albedo, rep[0], rep[1]);
    const normal = T(heightToNormal(maps.height, opts.hStrength ?? 2.4), rep[0], rep[1], false);
    // Карта шероховатости: без неё вся поверхность блестит одинаково и выглядит пластиком.
    const roughMap = maps.rough ? T(maps.rough, rep[0], rep[1], false) : null;
    // AO из карты высот: затемняет углубления (швы, стыки, каверны).
    const aoMap = T(heightToAO(maps.height, opts.aoPower ?? 1.0), rep[0], rep[1], false);
    const mat = new THREE.MeshStandardMaterial({
      map: albedo, normalMap: normal,
      normalScale: new THREE.Vector2(normScale, normScale),
      roughnessMap: roughMap,
      aoMap, aoMapIntensity: opts.ao ?? 0.85,
      roughness: opts.rough ?? 0.92, metalness: opts.metal ?? 0.0,
      side: opts.side ?? THREE.FrontSide,
      envMapIntensity: opts.env ?? 0.55
    });
    return mat;
  };
  MAPS.osb   = osbMaps(TS(1024), 1.0);
  MAPS.osb2  = osbMaps(TS(1024), 0.92);
  MAPS.conc  = concreteMaps(TS(768));
  MAPS.wood  = lumberMaps(TS(768));
  MAPS.corr  = corrugatedMaps(TS(512), 0.45, [124,118,110], 7);
  MAPS.roof  = corrugatedMaps(TS(512), 0.62, [168,154,136], 6);
  MAPS.steel = steelMaps(TS(512), [112,106,98]);
  MAPS.panel = panelMaps(TS(768));
  MAPS.hazard = hazardMaps(256);

  // roughness берётся из карт; числовое значение работает множителем
  M.osb   = mk(MAPS.osb , [1,1], 1.05, {rough:1.0, hStrength:2.2, ao:.95, env:.28});
  M.osb2  = mk(MAPS.osb2, [1,1], 1.05, {rough:1.0, hStrength:2.2, ao:.95, env:.28});
  M.conc  = mk(MAPS.conc, [1,1], 0.80, {rough:1.0, ao:.95, env:.22, aoPower:1.15});
  M.wood  = mk(MAPS.wood, [1,1], 0.5, {rough:1.0, ao:.75, env:.28, hStrength:1.2});
  M.corr  = mk(MAPS.corr, [1,1], 1.20, {rough:1.0, metal:.25, side:THREE.DoubleSide, env:1.0, ao:.6});
  M.roof  = mk(MAPS.roof, [1,1], 1.15, {rough:1.0, metal:.15, side:THREE.DoubleSide, env:1.0, ao:.55});
  M.steel = mk(MAPS.steel,[1,1], 0.95, {rough:1.0, metal:.35, env:1.0, ao:.6});
  M.panel = mk(MAPS.panel,[1,1], 0.95, {rough:1.0, ao:.95, env:.25, aoPower:1.1});
  M.hazard = mk(MAPS.hazard,[1,1], 0.9, {rough:1.0, metal:.28, env:.8, ao:.7});

  // Крашеный металл: приглушённые, выгоревшие цвета вместо ярких «пластиковых».
  M.dark   = new THREE.MeshStandardMaterial({color:0x4a463f, roughness:.7, metalness:.3, envMapIntensity:1.1});
  M.darker = new THREE.MeshStandardMaterial({color:0x262320, roughness:.78, metalness:.45});
  M.rubber = new THREE.MeshStandardMaterial({color:0x1a1b1d, roughness:.94, metalness:.03});
  M.plastO = new THREE.MeshStandardMaterial({color:0x9c5734, roughness:.66, metalness:.05});
  M.plastB = new THREE.MeshStandardMaterial({color:0x3a5470, roughness:.66, metalness:.06});
  M.paintG = new THREE.MeshStandardMaterial({color:0x4e5a46, roughness:.68, metalness:.22});
  M.paintY = new THREE.MeshStandardMaterial({color:0xa88a4c, roughness:.66, metalness:.25});
  // Без transmission: он требует отдельного прохода рендера, стоит дорого и
  // на части драйверов роняет кадр в чёрный. Грязное стекло даёт тот же вид дешевле.
  M.glass  = new THREE.MeshStandardMaterial({
    color:0xc4cfd6, roughness:.46, metalness:0, side:THREE.DoubleSide,
    transparent:true, opacity:.78, emissive:0xd8dee4, emissiveIntensity:0.42,
    map: T(dirtyGlassMaps(TS(256)), 1, 1)
  });
  M.tarp   = new THREE.MeshStandardMaterial({color:0x545a52, roughness:.92, side:THREE.DoubleSide});
  M.foam   = new THREE.MeshStandardMaterial({color:0xbdb6a4, roughness:.97});
  M.cable  = new THREE.MeshStandardMaterial({color:0x222326, roughness:.82});
  M.dirt   = new THREE.MeshStandardMaterial({color:0x6a6154, roughness:.98});

  /* --- Материалы техники: машины, вертолёт, флаг --- */
  // Автоэмаль: гладкая, с ясным зеркальным откликом, но выгоревшая и в пыли.
  const carPaint = (col)=> new THREE.MeshStandardMaterial({
    color:col, roughness:.42, metalness:.42, envMapIntensity:1.15 });
  M.carRed   = carPaint(0x7d2c26);
  M.carBlue  = carPaint(0x2c4257);
  M.carWhite = carPaint(0x9a9a94);
  M.carSand  = carPaint(0x8a7a52);
  M.carGreen = carPaint(0x3f4a38);
  M.carBlack = carPaint(0x1e1f22);
  // Кузовное стекло: тонированное, почти непрозрачное снаружи.
  M.carGlass = new THREE.MeshStandardMaterial({
    color:0x2a3138, roughness:.16, metalness:.2, envMapIntensity:1.6,
    transparent:true, opacity:.82, side:THREE.DoubleSide });
  M.chrome   = new THREE.MeshStandardMaterial({color:0xb4b8bc, roughness:.24, metalness:.92, envMapIntensity:1.6});
  M.lightRed = new THREE.MeshStandardMaterial({color:0x8c211c, roughness:.22, metalness:.1,
    emissive:0x3a0806, emissiveIntensity:.5, transparent:true, opacity:.9});
  M.lightAmb = new THREE.MeshStandardMaterial({color:0xb2761e, roughness:.22, metalness:.1,
    emissive:0x452c06, emissiveIntensity:.5, transparent:true, opacity:.9});
  M.headlamp = new THREE.MeshStandardMaterial({color:0xcfd3d2, roughness:.12, metalness:.35,
    emissive:0x23262a, emissiveIntensity:.3, envMapIntensity:1.8});
  M.heliBody = new THREE.MeshStandardMaterial({color:0x37443a, roughness:.5, metalness:.38, envMapIntensity:1.1});
  M.heliTrim = new THREE.MeshStandardMaterial({color:0x9a3a22, roughness:.52, metalness:.3});
  M.heliGlass= new THREE.MeshStandardMaterial({
    color:0x86949c, roughness:.1, metalness:.05, envMapIntensity:1.5,
    transparent:true, opacity:.5, side:THREE.DoubleSide });
  M.flag = new THREE.MeshStandardMaterial({
    map: flagTex(TS(512),TS(320)), roughness:.95, metalness:0,
    side:THREE.DoubleSide, transparent:true, alphaTest:0.35 });
  // helipadTex/parkingTex уже возвращают Texture — оборачивать их в T() нельзя,
  // иначе CanvasTexture получает не canvas и поверхность выходит чёрной.
  M.helipad = new THREE.MeshStandardMaterial({
    map: helipadTex(TS(1024)), roughness:.93, metalness:.03, envMapIntensity:.3 });
  M.parkLine = new THREE.MeshStandardMaterial({
    map: parkingTex(TS(1024)), transparent:true, depthWrite:false, roughness:.92, metalness:0,
    polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3 });
}
/** Кэш простых цветных материалов. Отдельный материал на каждый объект
    ломает слияние: две одинаковые бочки попадали бы в разные вызовы. */
const _matCache = new Map();
function cmat(color, o={}){
  const key = color+'|'+JSON.stringify(o);
  let m = _matCache.get(key);
  if(!m){
    m = new THREE.MeshStandardMaterial(Object.assign({color}, o));
    _matCache.set(key, m);
  }
  return m;
}

/* ---------------------------------------------------------------------------
   ОБУГЛИВАНИЕ ДЕРЕВА
   Каждая вершина деревянной геометрии несёт aBurn = (обугленность, жар).
   Обугленность только растёт: древесина сначала темнеет до коричневого,
   затем чернеет и растрескивается «крокодиловой кожей». Жар — отдельный
   канал: пока он выше нуля, трещины тлеют оранжевым и мерцают, а когда
   огонь уходит, остывают — уголь остаётся чёрным.
--------------------------------------------------------------------------- */
const BURN_U = { uTime:{value:0} };
function makeBurnable(mat){
  mat.userData.burnable = true;
  mat.onBeforeCompile = (sh)=>{
    sh.uniforms.uTime = BURN_U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aBurn; varying vec2 vBurn; varying vec3 vBurnPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBurn = aBurn; vBurnPos = (modelMatrix*vec4(transformed,1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; varying vec2 vBurn; varying vec3 vBurnPos;
        float bh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        float bnoise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(bh(i),bh(i+vec3(1,0,0)),f.x), mix(bh(i+vec3(0,1,0)),bh(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(bh(i+vec3(0,0,1)),bh(i+vec3(1,0,1)),f.x), mix(bh(i+vec3(0,1,1)),bh(i+vec3(1,1,1)),f.x),f.y), f.z); }
        // «крокодиловая кожа» угля: расстояние до границы ячеек Вороного
        float cracks(vec3 p){ vec3 i=floor(p), f=fract(p); float d1=8.0, d2=8.0;
          for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){
            vec3 g=vec3(x,y,z); vec3 o=vec3(bh(i+g),bh(i+g+7.1),bh(i+g+3.3));
            float d=length(g+o-f); if(d<d1){d2=d1;d1=d;} else if(d<d2) d2=d; }
          return d2-d1; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float bN = bnoise(vBurnPos*5.0)*0.6 + bnoise(vBurnPos*17.0)*0.4;
        float bChar = clamp(vBurn.x*1.25 + (bN-0.5)*0.35, 0.0, 1.0);
        float bScorch = smoothstep(0.02, 0.35, bChar);
        float bBlack = smoothstep(0.35, 0.8, bChar);
        float bCr = cracks(vBurnPos*vec3(9.0,4.5,9.0));
        vec3 scorchCol = diffuseColor.rgb*vec3(0.52,0.36,0.22);
        vec3 charCol = mix(vec3(0.028,0.024,0.021), vec3(0.075,0.066,0.058), smoothstep(0.02,0.14,bCr));
        diffuseColor.rgb = mix(diffuseColor.rgb, scorchCol, bScorch);
        diffuseColor.rgb = mix(diffuseColor.rgb, charCol, bBlack);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.97, bScorch);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float bHeat = vBurn.y * bBlack;
        float bFl = 0.65 + 0.35*sin(uTime*7.0 + bN*20.0)*sin(uTime*3.1 + bN*9.0);
        // светятся только тонкие трещины угля, и то пятнами — сплошной «лавы» нет
        float bPatch = smoothstep(0.35, 0.75, bnoise(vBurnPos*3.0 + uTime*0.15));
        float bEmb = (1.0 - smoothstep(0.0, 0.045, bCr)) * bHeat * bFl * (0.25 + 0.75*bPatch);
        totalEmissiveRadiance += vec3(1.0,0.30,0.05) * (bEmb*3.2 + bHeat*bHeat*0.06*bFl);`);
  };
  mat.customProgramCacheKey = ()=> 'burn1';
  return mat;
}

/** Дополнительные материалы: командные флаги, решётка, декали, эффекты. */
const FX = {};
function buildExtraMaterials(){
  makeBurnable(M.osb); makeBurnable(M.osb2); makeBurnable(M.wood);
  // брус и фанера под покраску для укрытий: та же древесина, свой тон
  M.woodDark = makeBurnable(M.wood.clone()); M.woodDark.color = new THREE.Color(0x8a7a62);
  M.plywood  = makeBurnable(M.osb.clone());  M.plywood.color  = new THREE.Color(0xc9b793);

  M.flagAlpha = new THREE.MeshStandardMaterial({ map: teamFlagTex('ALPHA', TS(1024), TS(640)),
    roughness:.9, side:THREE.DoubleSide, alphaTest:0.4 });
  M.flagDelta = new THREE.MeshStandardMaterial({ map: teamFlagTex('DELTA', TS(1024), TS(640)),
    roughness:.92, side:THREE.DoubleSide, alphaTest:0.4 });

  const gr = gratingMaps(256);
  const grA = T(gr.albedo, 1, 1);
  M.grating = new THREE.MeshStandardMaterial({ map: grA, alphaTest:0.5, side:THREE.DoubleSide,
    normalMap: T(heightToNormal(gr.height, 3.0),1,1,false), roughness:.62, metalness:.55, envMapIntensity:.9 });

  // Сетка габиона (HESCO): проволочная решётка поверх мешка с песком.
  M.hesco = new THREE.MeshStandardMaterial({ color:0x8f8466, roughness:.96, metalness:0 });
  M.hescoMesh = new THREE.MeshStandardMaterial({ map: grA, alphaTest:0.5, color:0xb0aca4,
    roughness:.5, metalness:.7, side:THREE.DoubleSide });
  M.sand = new THREE.MeshStandardMaterial({ color:0x8c7c5c, roughness:1 });
  M.sandbag = new THREE.MeshStandardMaterial({ color:0x77704f, roughness:.97 });

  // Командные цвета: окраска укрытий, разметка и подсветка баз.
  M.teamA = new THREE.MeshStandardMaterial({ color:0x2a2c30, roughness:.6, metalness:.35 });
  M.teamD = new THREE.MeshStandardMaterial({ color:0x4f5a3a, roughness:.7, metalness:.2 });
  const [cc] = camoCanvas(512, 512, ['#6b6a4b','#4d5536','#8a7d58','#3a3d2a','#a39873'], 0.9);
  M.camo = new THREE.MeshStandardMaterial({ map: texOf(cc), roughness:.95 });
  M.stripeA = new THREE.MeshStandardMaterial({ color:0xd8dde2, roughness:.6, emissive:0x9ab4d8, emissiveIntensity:0.0 });
  M.stripeD = new THREE.MeshStandardMaterial({ color:0x9cc27a, roughness:.6, emissive:0x7ab04c, emissiveIntensity:0.0 });

  // Декали повреждений: общий атлас, один материал — один вызов на все дырки.
  FX.decalTex = decalAtlas(TS(1024));
  M.decal = new THREE.MeshStandardMaterial({ map: FX.decalTex, transparent:true, depthWrite:false,
    polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4, roughness:.95, alphaTest:0.02 });
  const cr = craterMaps(TS(512));
  M.crater = new THREE.MeshStandardMaterial({ map: cr.map, normalMap: cr.normal, normalScale:new THREE.Vector2(2.2,2.2),
    transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2, roughness:1 });
  M.concChunk = M.conc;
  M.ember = new THREE.MeshStandardMaterial({ color:0x1a1512, roughness:1, emissive:0xff5a14, emissiveIntensity:1.6 });

  FX.flame = flameTex(128);
  FX.smoke = smokeTex(128);
  FX.glow  = glowTex(64);
}
function buildAllMaterials(){ buildMaterials(); buildExtraMaterials(); }

export { MAPS, M, FX, cmat, buildAllMaterials, BURN_U, makeBurnable };
