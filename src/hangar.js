// Ангар: пол, стены, остекление, фермы, кровля с проёмами, светильники.
import { THREE, scene, sr, srnd, si, lerp, clamp, Q } from './engine.js';
import { M, cmat } from './materials.js';
import { addBox, bucket, uvBox, COLLIDERS, SHOOTABLE, _m4, _q, _e, roundedBox } from './builder.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
/* ============================================================================
   АНГАР
   Кровля собирается из полос с реальными пропусками — сквозь них светит солнце.
============================================================================ */
const HW = 40, HD = 30;            // полуразмеры ангара (80 x 60 м)
const WALL_H = 5.6;                // верх бетонного цоколя + низ остекления
const EAVE = 9.2, RIDGE = 12.6;    // карниз и конёк
const roofY = z => EAVE + (RIDGE-EAVE)*(1 - Math.abs(z)/HD);
const LAMPS = [], SUNHOLES = [], WINDOWS = [];
/** Шаг колонн ангара. Из него же считаются фермы и ряды светильников. */
const COL_STEP = 7.5;
const COL_X = (()=>{
  const out = [], n = Math.floor((HW-4)/COL_STEP);
  for(let i=-n;i<=n;i++) out.push(i*COL_STEP);
  return out;
})();

function buildHangar(){
  /* --- пол: плиты 6x6 м с небольшим разбросом оттенка --- */
  const tiles = [];
  for(let i=0;i<Math.ceil(HW*2/6);i++) for(let j=0;j<Math.ceil(HD*2/6);j++){
    const x0 = -HW + i*6, z0 = -HD + j*6;
    const x1 = Math.min(x0+6, HW), z1 = Math.min(z0+6, HD);
    const g = new THREE.PlaneGeometry(x1-x0, z1-z0);
    g.rotateX(-Math.PI/2); g.translate((x0+x1)/2, 0, (z0+z1)/2);
    const uv = g.attributes.uv;
    // Случайный сдвиг И поворот UV на плиту: одинаковый тайл перестаёт читаться.
    const rot = Math.floor(srnd()*4)*Math.PI/2, cs=Math.cos(rot), sn=Math.sin(rot);
    const ou = srnd()*7, ov = srnd()*7;
    for(let k=0;k<uv.count;k++){
      const u0 = uv.getX(k)*(x1-x0)*0.42, v0 = uv.getY(k)*(z1-z0)*0.42;
      uv.setXY(k, u0*cs - v0*sn + ou, u0*sn + v0*cs + ov);
    }
    tiles.push(g);
    // деформационный шов по краю плиты
    if(x1 < HW-0.01) addBox('darker', x1, 0.004, (z0+z1)/2, 0.035, 0.03, z1-z0, {collide:false, d:1});
    if(z1 < HD-0.01) addBox('darker', (x0+x1)/2, 0.004, z1, x1-x0, 0.03, 0.035, {collide:false, d:1});
  }
  const floor = new THREE.Mesh(BGU.mergeGeometries(tiles,false), M.conc);
  floor.receiveShadow = true; floor.name='floor';
  scene.add(floor); SHOOTABLE.push(floor);
  COLLIDERS.push({x0:-HW-2,y0:-2,z0:-HD-2,x1:HW+2,y1:0,z1:HD+2});

  /* --- стены: бетонный цоколь, ленточное остекление, профлист фронтона --- */
  const GLASS_Y0 = WALL_H, GLASS_H = 2.3;
  const wallSeg = (cx,cz,sx,sz)=>{
    addBox('panel', cx, WALL_H/2, cz, sx, WALL_H, sz, {d:.30});
  };
  wallSeg(0, -HD, HW*2+0.4, .44);  wallSeg(0, HD, HW*2+0.4, .44);
  // торцевые стены с проёмом под приоткрытые ворота баз (z 0.4…2.0)
  for(const sx of [-1,1]){
    wallSeg(sx*HW, (-HD+0.4)/2, .44, HD+0.4);
    wallSeg(sx*HW, (2.0+HD)/2, .44, HD-2.0);
  }
  // Лента остекления — отдельные Plane без объёма: добавляем ей коллайдер,
  // иначе выше цоколя оболочка ангара дырявая.
  for(const s of [-1,1]){
    COLLIDERS.push({x0:-HW-0.3, y0:WALL_H, z0:s*HD-0.25, x1:HW+0.3, y1:EAVE, z1:s*HD+0.25});
    COLLIDERS.push({x0:s*HW-0.25, y0:WALL_H, z0:-HD-0.3, x1:s*HW+0.25, y1:EAVE, z1:HD+0.3});
  }

  // рама остекления + стёкла (длинные ленты под карнизом)
  function glazing(axis, sign){
    const along = axis==='x' ? HW : HD;
    const n = axis==='x' ? Math.round(HW*2/4.9) : Math.round(HD*2/4.9);
    for(let i=0;i<n;i++){
      const t = -along + (i+0.5)*(along*2/n);
      const wseg = (along*2/n) * 0.82;
      const px = axis==='x' ? t : sign*HW, pz = axis==='x' ? sign*HD : t;
      const yc = GLASS_Y0 + GLASS_H/2;
      const g = new THREE.PlaneGeometry(wseg, GLASS_H);
      const m = new THREE.Mesh(g, M.glass);
      m.position.set(px, yc, pz);
      m.rotation.y = axis==='x' ? (sign>0 ? Math.PI : 0) : (sign>0 ? -Math.PI/2 : Math.PI/2);
      m.userData.glass = {w:wseg, h:GLASS_H}; m.userData.nomerge = true;
      scene.add(m);
      WINDOWS.push({pos:new THREE.Vector3(px,yc,pz), axis, sign, w:wseg, h:GLASS_H});
      // переплёт
      const inw = axis==='x' ? 0 : -sign*0.06, ind = axis==='x' ? -sign*0.06 : 0;
      const cols = 5;
      for(let k=0;k<=cols;k++){
        const off = -wseg/2 + k*wseg/cols;
        const bx = axis==='x' ? px+off : px+inw, bz = axis==='x' ? pz+ind : pz+off;
        addBox('dark', bx, yc, bz, axis==='x'?0.05:0.1, GLASS_H, axis==='x'?0.1:0.05, {collide:false, d:1});
      }
      for(const yy of [GLASS_Y0+0.02, GLASS_Y0+GLASS_H-0.02]){
        const bx = axis==='x' ? px : px+inw, bz = axis==='x' ? pz+ind : pz;
        addBox('dark', bx, yy, bz, axis==='x'?wseg:0.1, 0.07, axis==='x'?0.1:wseg, {collide:false, d:1});
      }
    }
    // сплошной профлист между остеклением и карнизом
    const topY0 = GLASS_Y0 + GLASS_H, topH = EAVE - topY0;
    if(topH > 0.1){
      if(axis==='x') addBox('corr', 0, topY0+topH/2, sign*HD, HW*2+0.4, topH, .3, {d:.45});
      else           addBox('corr', sign*HW, topY0+topH/2, 0, .3, topH, HD*2, {d:.45});
    }
  }
  glazing('x',-1); glazing('x',1); glazing('z',-1); glazing('z',1);

  // Фронтоны. Конёк идёт вдоль X, значит скат меняет высоту по Z —
  // треугольные щипцы закрывают торцы по X, а не по Z.
  for(const s of [-1,1]){
    const shape = new THREE.Shape();
    shape.moveTo(-HD, EAVE); shape.lineTo(HD, EAVE); shape.lineTo(0, RIDGE);
    const g = new THREE.ShapeGeometry(shape);
    const uv = g.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i, uv.getX(i)*0.42, uv.getY(i)*0.42);
    const m = new THREE.Mesh(g, M.corr);
    m.position.set(s*HW, 0, 0);
    m.rotation.y = s>0 ? Math.PI/2 : -Math.PI/2;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); SHOOTABLE.push(m);
    // стойки щипца
    for(const zz of [-HD*0.5, 0, HD*0.5]){
      const top = roofY(zz);
      if(top - EAVE < 0.15) continue;
      addBox('steel', s*HW, (EAVE+top)/2, zz, 0.2, top-EAVE, 0.14, {collide:false, d:1.2});
    }
  }
  // по торцам Z скат заканчивается на карнизе — там простой парапет
  for(const s of [-1,1]) addBox('corr', 0, EAVE+0.18, s*HD, HW*2+0.4, 0.36, 0.3, {collide:false, d:.6});

  /* --- каркас: колонны, фермы, прогоны --- */
  const colX = COL_X;
  for(const cx of colX){
    for(const cz of [-HD+0.6, HD-0.6]){
      // двутавр из трёх пластин
      addBox('steel', cx, EAVE/2, cz, 0.42, EAVE, 0.10, {d:1.1});
      addBox('steel', cx, EAVE/2, cz-0.14, 0.14, EAVE, 0.28, {collide:false, d:1.1});
      addBox('steel', cx, EAVE/2, cz+0.14, 0.14, EAVE, 0.28, {collide:false, d:1.1});
      addBox('dark', cx, 0.12, cz, 0.62, 0.24, 0.62, {d:1.2});       // база
      addBox('steel', cx, EAVE-0.5, cz + (cz<0?0.55:-0.55), 0.3, 0.9, 1.3, {collide:false, d:1});
    }
  }
  // стропильные фермы поперёк ангара
  for(const cx of colX){
    const segs = Math.round(HD*2/2.7);
    for(let i=0;i<segs;i++){
      const z0 = -HD + i*(HD*2/segs), z1 = -HD + (i+1)*(HD*2/segs);
      const y0 = roofY(z0), y1 = roofY(z1);
      // верхний пояс
      const len = Math.hypot(z1-z0, y1-y0);
      const g = new THREE.BoxGeometry(0.16, 0.20, len);
      uvBox(g, 0.16,0.2,len, 1.2);
      _e.set(Math.atan2(y1-y0, z1-z0)*-1, 0, 0); _q.setFromEuler(_e);
      _m4.compose(new THREE.Vector3(cx,(y0+y1)/2-0.12,(z0+z1)/2), _q, new THREE.Vector3(1,1,1));
      g.applyMatrix4(_m4); bucket('steel').push(g);
      // нижний пояс и раскосы
      const by = EAVE - 0.15;
      addBox('steel', cx, by, (z0+z1)/2, 0.14, 0.16, z1-z0, {collide:false, d:1.2});
      const dy = (y0+y1)/2 - 0.2 - by;
      if(dy > 0.25){
        addBox('steel', cx, by + dy/2, (z0+z1)/2, 0.09, dy, 0.09, {collide:false, d:1.2});
        const dl = Math.hypot(dy, (z1-z0));
        const gd = new THREE.BoxGeometry(0.07, 0.07, dl); uvBox(gd,0.07,0.07,dl,1.2);
        _e.set(Math.atan2(dy, z1-z0)*-1, 0, 0); _q.setFromEuler(_e);
        _m4.compose(new THREE.Vector3(cx, by+dy/2, (z0+z1)/2), _q, new THREE.Vector3(1,1,1));
        gd.applyMatrix4(_m4); bucket('steel').push(gd);
      }
    }
  }
  // продольные прогоны под кровлей
  const purlinN = Math.round(HD*2/2.1);
  for(let i=0;i<=purlinN;i++){
    const z = -HD + i*(HD*2/purlinN);
    addBox('steel', 0, roofY(z)-0.30, z, HW*2, 0.11, 0.13, {collide:false, d:1.4});
  }
  // горизонтальные связи по верху колонн
  for(const cz of [-HD+0.6, HD-0.6]) addBox('steel', 0, EAVE-0.15, cz, HW*2, 0.18, 0.14, {collide:false, d:1.4});
}

/* --- кровля: полосы профлиста с реальными пропусками под световые проёмы --- */
function buildRoof(){
  // сетка проёмов: часть закрыта поликарбонатом, часть — сквозные дыры (солнце бьёт столбом)
  const holes = [];
  const holeN = Math.round(HW*2/6);
  for(let i=0;i<holeN;i++){
    const x = -HW+4 + i*((HW*2-8)/(holeN-1)) + sr(-0.8,0.8);
    const z = (i%2 ? 1 : -1) * sr(4.5, HD-5);
    const w = sr(2.4,3.6), d = sr(1.8,2.8);
    holes.push({x, z, w, d, open: srnd() < 0.45});
  }
  // пара крупных провалов у конька — главный источник световых столбов
  holes.push({x:-6.5, z:2.0, w:4.6, d:3.4, open:true});
  holes.push({x:11.5, z:-3.5, w:4.0, d:3.0, open:true});
  holes.push({x:-24.0, z:-9.0, w:4.2, d:3.2, open:true});
  holes.push({x:25.0, z:11.0, w:4.4, d:3.2, open:true});

  const stripN = Math.round(HD*2/1.5);                // полосы вдоль X, режем по Z
  for(let i=0;i<stripN;i++){
    const z0 = -HD + i*(HD*2/stripN), z1 = -HD + (i+1)*(HD*2/stripN);
    const zc = (z0+z1)/2;
    // сегменты по X с вырезами под проёмы, пересекающие эту полосу
    let spans = [[-HW-0.3, HW+0.3]];
    for(const h of holes){
      if(zc < h.z-h.d/2 || zc > h.z+h.d/2) continue;
      const nx = [];
      for(const [a,b] of spans){
        const c0 = h.x-h.w/2, c1 = h.x+h.w/2;
        if(c1 <= a || c0 >= b){ nx.push([a,b]); continue; }
        if(a < c0) nx.push([a,c0]);
        if(c1 < b) nx.push([c1,b]);
      }
      spans = nx;
    }
    for(const [a,b] of spans){
      if(b-a < 0.12) continue;
      const y0 = roofY(z0), y1 = roofY(z1);
      const len = Math.hypot(z1-z0, y1-y0);
      const g = new THREE.PlaneGeometry(b-a, len);
      const uv = g.attributes.uv;
      for(let k=0;k<uv.count;k++) uv.setXY(k, uv.getX(k)*(b-a)*0.30, uv.getY(k)*len*0.30);
      const m = new THREE.Mesh(g, M.roof);
      m.position.set((a+b)/2, (y0+y1)/2, zc);
      m.rotation.x = -Math.PI/2 + Math.atan2(y1-y0, z1-z0);
      m.castShadow = true; m.receiveShadow = true;
      m.name = 'roofstrip';
      scene.add(m); SHOOTABLE.push(m);
    }
  }
  // конёк
  addBox('roof', 0, RIDGE+0.06, 0, HW*2+0.6, 0.12, 0.85, {collide:false, d:1.2});
  /* Кровля как преграда: полосы — плоскости без толщины, по ним AABB не
     построить. Вместо этого ставим ступенчатый «потолок» по скату, пропуская
     сквозные проёмы — через них по-прежнему можно вылететь наружу. */
  const CEIL_N = 20;
  for(let i=0;i<CEIL_N;i++){
    const za = -HD + i*(HD*2/CEIL_N), zb = -HD + (i+1)*(HD*2/CEIL_N);
    const zc = (za+zb)/2, y = roofY(zc);
    let spans = [[-HW-0.3, HW+0.3]];
    for(const h of holes){
      if(!h.open) continue;                       // застеклённые проёмы твёрдые
      if(zc < h.z-h.d/2 || zc > h.z+h.d/2) continue;
      const nx = [];
      for(const [a,b] of spans){
        const c0 = h.x-h.w/2, c1 = h.x+h.w/2;
        if(c1 <= a || c0 >= b){ nx.push([a,b]); continue; }
        if(a < c0) nx.push([a,c0]);
        if(c1 < b) nx.push([c1,b]);
      }
      spans = nx;
    }
    for(const [a,b] of spans){
      if(b-a < 0.2) continue;
      COLLIDERS.push({x0:a, y0:y-0.12, z0:za, x1:b, y1:y+0.9, z1:zb});
    }
  }
  // фронтоны и парапеты торцов: замыкают оболочку выше карниза
  for(const s of [-1,1]){
    COLLIDERS.push({x0:s*HW-0.35, y0:EAVE-0.2, z0:-HD, x1:s*HW+0.35, y1:RIDGE+0.4, z1:HD});
    COLLIDERS.push({x0:-HW, y0:EAVE-0.2, z0:s*HD-0.35, x1:HW, y1:roofY(s*HD)+0.6, z1:s*HD+0.35});
  }
  // остекление/поликарбонат в закрытых проёмах + регистрация открытых для лучей
  for(const h of holes){
    const y = roofY(h.z);
    if(!h.open){
      const g = new THREE.PlaneGeometry(h.w, h.d);
      const m = new THREE.Mesh(g, M.glass);
      m.position.set(h.x, y-0.02, h.z); m.rotation.x = -Math.PI/2;
      scene.add(m);
    }
    // обрамление проёма
    addBox('steel', h.x, y-0.08, h.z-h.d/2, h.w+0.2, 0.12, 0.12, {collide:false, d:1.2});
    addBox('steel', h.x, y-0.08, h.z+h.d/2, h.w+0.2, 0.12, 0.12, {collide:false, d:1.2});
    SUNHOLES.push({x:h.x, y, z:h.z, w:h.w, d:h.d, open:h.open});
  }
  // пара дыр в стене профлиста (пробоины, как в заброшке)
  for(let i=0;i<3;i++){
    const zz = sr(-HD+5, HD-5);
    addBox('darker', -HW+0.3, WALL_H+2.8, zz, 0.06, sr(0.6,1.4), sr(0.5,1.2), {collide:false, d:1});
  }
}

/* --- подвесные светильники --- */
/* Материалы ламп общие на всю карту: один объект материала — один вызов
   отрисовки на все сто трубок, и яркость всех ламп меняется разом. */
const LAMP_MAT = new THREE.MeshStandardMaterial({
  color:0x8e9298, emissive:0xfff4dc, emissiveIntensity:0.0, roughness:.42, metalness:.05 });
const LAMP_DEAD = new THREE.MeshStandardMaterial({color:0x6e7176, roughness:.62});
const FLICKER = [];
function setLampGlow(level){
  LAMP_MAT.emissiveIntensity = 2.6*level;
  LAMP_MAT.color.setRGB(lerp(0.44,0.92,level), lerp(0.46,0.94,level), lerp(0.49,0.96,level));
  for(const l of LAMPS) if(l.on && !l.flick) l.lit = level;
}
function buildLamps(){
  const rows = Math.round(HD*2/9), cols = Math.round(HW*2/5.5);
  for(let r=0;r<rows;r++){
    const z = -HD + 4 + r*((HD*2-8)/Math.max(1,rows-1));
    for(let i=0;i<cols;i++){
      const x = -HW + 4 + i*((HW*2-8)/Math.max(1,cols-1));
      const y = roofY(z) - 1.25;
      // корпус + отражатель
      addBox('dark', x, y+0.12, z, 1.85, 0.11, 0.30, {collide:false, d:1.4});
      const on = srnd() < 0.86 ? 1 : 0;
      // каждая двенадцатая рабочая лампа мигает — признак умирающей проводки
      const flick = on && srnd() < 0.085;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.048,0.048,1.72,8),
        flick ? LAMP_MAT.clone() : (on ? LAMP_MAT : LAMP_DEAD));
      tube.rotation.z = Math.PI/2; tube.position.set(x, y, z);
      if(flick) tube.userData.nomerge = true;    // своя яркость каждый кадр
      scene.add(tube);
      // подвесы
      for(const o of [-0.7, 0.7]){
        addBox('dark', x+o, y+0.62, z, 0.035, 0.9, 0.035, {collide:false, d:1});
      }
      const rec = {pos:new THREE.Vector3(x,y-0.2,z), mesh:tube, on, flick,
                   lit:0, ph:sr(0,99), rate:sr(5.5,13.0)};
      LAMPS.push(rec);
      if(flick) FLICKER.push(rec);
    }
  }
}
/* --- ночная иллюминация: прожекторы, натриевые светильники, указатели --- */
const NIGHT_EMIS = [];              // материалы, разгорающиеся к ночи
const FLOODS = [];                  // прожекторы с настоящим световым конусом
function nightMat(color, peak=2.4){
  const m = new THREE.MeshStandardMaterial({
    color:0x2a2a2c, emissive:color, emissiveIntensity:0, roughness:.4, metalness:.1 });
  NIGHT_EMIS.push({mat:m, peak, base:new THREE.Color(color)});
  return m;
}
const MAT_SODIUM = nightMat(0xffa63c, 3.1);   // натриевый фонарь: тёплый оранжевый
const MAT_FLOOD  = nightMat(0xfff0d0, 3.6);   // галогенный прожектор
const MAT_EXIT   = nightMat(0x36d96a, 1.6);   // указатель выхода: горит всегда

/** Мачтовый прожектор: голова на кронштейне + узкий Spot вниз-внутрь.
    Spot включается только к ночи, днём он бесполезен и стоит кадра. */
function floodMast(x, z, aimX, aimZ, h=9.0){
  addBox('steel', x, h/2, z, 0.22, h, 0.22, {d:1.1});
  addBox('dark',  x, 0.16, z, 0.8, 0.32, 0.8, {d:1.2});
  // раскосы основания
  for(const a of [0, Math.PI/2, Math.PI, -Math.PI/2]){
    const g = new THREE.BoxGeometry(0.08, 1.5, 0.08);
    g.rotateX(0.42); g.rotateY(a);
    g.translate(x + Math.cos(a)*0.34, 0.8, z + Math.sin(a)*0.34);
    bucket('steel').push(g);
  }
  const dirX = aimX - x, dirZ = aimZ - z;
  const dl = Math.hypot(dirX, dirZ) || 1;
  const yaw = Math.atan2(dirX/dl, dirZ/dl);
  for(const off of [-0.44, 0.44]){
    const hx = x + Math.cos(yaw)*off + Math.sin(yaw)*0.28;
    const hz = z - Math.sin(yaw)*off + Math.cos(yaw)*0.28;
    // корпус головы
    const head = new THREE.Mesh(roundedBox(0.52,0.40,0.26,0.05,2), M.dark);
    head.position.set(hx, h-0.3, hz); head.rotation.y = yaw; head.rotation.x = 0.55;
    head.castShadow = true; scene.add(head);
    // линза: разгорается вместе с остальной ночной иллюминацией
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.42,0.30), MAT_FLOOD);
    lens.position.set(hx + Math.sin(yaw)*0.10, h-0.42, hz + Math.cos(yaw)*0.10);
    lens.rotation.y = yaw; lens.rotation.x = 0.55 - Math.PI/2 + Math.PI/2;
    lens.rotation.x = 0.55; scene.add(lens);
  }
  const spot = new THREE.SpotLight(0xffeccd, 0, 52, 0.62, 0.55, 1.4);
  spot.position.set(x, h-0.35, z);
  spot.target.position.set(aimX, 0.4, aimZ);
  scene.add(spot); scene.add(spot.target);
  FLOODS.push({light:spot, peak: 220});
}
/** Настенный натриевый светильник-«кобра» под козырьком. */
function wallLamp(x, y, z, rotY){
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.035,0.44,7), M.dark);
  arm.rotation.z = Math.PI/2; arm.rotation.y = rotY;
  arm.position.set(x + Math.sin(rotY)*0.22, y, z + Math.cos(rotY)*0.22);
  scene.add(arm);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 7, 0, Math.PI*2, 0, Math.PI*0.55), M.dark);
  hood.position.set(x + Math.sin(rotY)*0.46, y+0.03, z + Math.cos(rotY)*0.46);
  hood.castShadow = true; scene.add(hood);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.115, 9, 7), MAT_SODIUM);
  bulb.position.set(x + Math.sin(rotY)*0.46, y-0.06, z + Math.cos(rotY)*0.46);
  scene.add(bulb);
  LAMPS.push({pos:new THREE.Vector3(x + Math.sin(rotY)*0.5, y-0.15, z + Math.cos(rotY)*0.5),
              mesh:bulb, on:1, lit:0, warm:true});
}
/** Табличка «выход» над проёмом: единственный свет, горящий круглые сутки. */
function exitSign(x, y, z, rotY){
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.15, 0.05), M.darker);
  box.position.set(x, y, z); box.rotation.y = rotY; scene.add(box);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.12), MAT_EXIT);
  face.position.set(x + Math.sin(rotY)*0.032, y, z + Math.cos(rotY)*0.032);
  face.rotation.y = rotY; scene.add(face);
}
function buildNightLighting(){
  // Прожекторные мачты по углам ангара: ночью они лепят длинные тени
  // от здания на бетон, и карта остаётся читаемой.
  floodMast(-HW+3.0, -HD+3.0,  -6,  -4, 9.4);
  floodMast( HW-3.0, -HD+3.0,   6,  -4, 9.4);
  floodMast(-HW+3.0,  HD-3.0,  -6,   4, 9.4);
  floodMast( HW-3.0,  HD-3.0,   6,   4, 9.4);
  // настенные светильники по периметру ангара
  for(const z of [-20, -7, 7, 20]){
    wallLamp(-HW+0.6, 4.6, z,  Math.PI/2);
    wallLamp( HW-0.6, 4.6, z, -Math.PI/2);
  }
  for(const x of [-28, -10, 10, 28]){
    wallLamp(x, 4.6, -HD+0.6, 0);
    wallLamp(x, 4.6,  HD-0.6, Math.PI);
  }
}
/** Разгорание ночной иллюминации. Вынесено из applyDaylight, чтобы
    перебор материалов шёл одним проходом. */
function setNightGlow(level){
  for(const e of NIGHT_EMIS){
    // указатель выхода питается от аккумулятора и горит всегда
    const k = e.mat === MAT_EXIT ? Math.max(0.35, level) : level;
    e.mat.emissiveIntensity = e.peak * k;
  }
  for(const f of FLOODS){
    f.light.intensity = f.peak * level;
    f.light.visible = level > 0.02;
  }
}

/** Мигание умирающих ламп: короткие провалы яркости со случайным ритмом. */
function updateFlicker(t, LAMP_LEVEL=1){
  if(!FLICKER.length) return;
  for(const l of FLICKER){
    const n = Math.sin(t*l.rate + l.ph) * Math.sin(t*l.rate*0.37 + l.ph*1.7);
    const dip = n > 0.55 ? 0.08 : (n > 0.2 ? 0.55 : 1.0);
    l.lit = LAMP_LEVEL * dip;
    l.mesh.material.emissiveIntensity = 2.6 * l.lit;
  }
}

/* --- кабель-каналы, лотки и провисающие провода под фермами --- */
function buildServices(){
  for(const z of [-HD+3, -9, 9, HD-3]){
    addBox('dark', 0, EAVE-0.62, z, HW*2, 0.09, 0.26, {collide:false, d:1.4});
  }
  // провисающие кабели (кривые Безье)
  const cableMat = M.cable;
  for(let i=0;i<20;i++){
    const z = sr(-HD+2, HD-2), x0 = sr(-HW+2, 0), x1 = x0 + sr(6,18);
    const y = EAVE - sr(0.7,1.6), sag = sr(0.3,1.1);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x0, y, z),
      new THREE.Vector3((x0+x1)/2, y-sag, z+sr(-0.4,0.4)),
      new THREE.Vector3(x1, y, z)
    ]);
    const g = new THREE.TubeGeometry(curve, 14, sr(0.014,0.03), 5, false);
    const m = new THREE.Mesh(g, cableMat); m.castShadow = true;
    scene.add(m);
  }
  // вентиляционные короба на кровле
  for(const [x,z] of [[-18,6],[3,-10],[19,8],[-27,-14],[28,16]]){
    const y = roofY(z);
    addBox('dark', x, y+0.55, z, 1.5, 1.1, 1.5, {collide:false, d:.8});
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.85,0.85,0.12,14), M.dark);
    cap.position.set(x, y+1.16, z); scene.add(cap);
  }
}


export { HW, HD, WALL_H, EAVE, RIDGE, roofY, LAMPS, SUNHOLES, WINDOWS, COL_X, COL_STEP,
         buildHangar, buildRoof, buildLamps, buildNightLighting, buildServices,
         setLampGlow, setNightGlow, updateFlicker, FLICKER, NIGHT_EMIS, FLOODS,
         nightMat, MAT_SODIUM, MAT_FLOOD, MAT_EXIT, exitSign, wallLamp, floodMast, LAMP_MAT };
