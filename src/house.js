// Шут-хаус из OSB на каркасе: планировка, стены с проёмами, перекрытие,
// внутренние деревянные и наружные стальные лестницы. Все проёмы, марши и
// площадки берутся из одних таблиц — лестница не может упереться в стену.
import { THREE, scene, Q, sr, srnd, clamp } from './engine.js';
import { M, cmat } from './materials.js';
import { addBox, addOBB, bucket, uvBox, tintGeo, beamBetween, _m4, _q, _e } from './builder.js';
import { createSheet, createBeam, registerGlass, registerProp } from './destruction.js';
import { exitSign, LAMPS } from './hangar.js';

export const BX0=-15, BX1=15, BZ0=-9.5, BZ1=9.5;
export const H1 = 3.05;            // высота стен 1 этажа (верх обвязки)
export const JOIST = 0.235, SUBF = 0.022;
export const F2 = H1 + JOIST + SUBF; // отметка чистого пола 2 этажа = 3.307
export const H2 = 2.9;             // стены 2 этажа
export const TH = 0.14, SHEET = 0.0125, STUD = 0.045, STEP = 0.61;
export const ATR = {x0:-4.5, z0:-3.5, x1:4.5, z1:3.5};
const CZ = 1.3;                    // полуширина коридоров крыльев
const PX = 9.75;                   // перегородка между комнатами крыла
/** Внутренние марши: x0..x1 — ширина, z — низ и направление (к фасаду). */
export const STAIRS_IN = [
  {x0:-14.92, x1:-13.72, zBot:-1.95, dir:-1},   // СЗ комната, вверх на север
  {x0: 13.72, x1: 14.92, zBot: 1.95, dir: 1}    // ЮВ комната, вверх на юг
];
const RUN_IN = 5.2;
/** Наружные стальные лестницы к дверям 2 этажа (перпендикулярно фасаду). */
export const STAIRS_OUT = [
  {x:-7.2, side:'n'}, {x: 7.2, side:'s'}
];
const RUN_OUT = 5.4, PLAT_D = 1.8, PLAT_W = 2.4;
export const WALLS = [];           // для миникарты и декора
export const DOORS = [];           // центры дверей (миникарта, свет)

const DOOR_W = 1.2, DOOR_H = 2.1;
const D  = (c,w=DOOR_W)=>({at:c, w, y0:0, y1:DOOR_H, door:true});
const Wn = (c,w=1.2, glass=false)=>({at:c, w, y0:0.95, y1:2.0, glass});
const Wl = (c,w=2.2)=>({at:c, w, y0:1.0, y1:2.05});           // широкий проём

/* ============================================================================
   СТЕНА: обвязка, стойки (разрушаемый брус), перемычки, обшивка листами из
   кусков с обеих сторон. Промежуточный ригель идёт только между стойками
   вне проёмов — поперёк двери ничего не висит.
============================================================================ */
export function buildWall(x1,z1,x2,z2, y0,h, opt={}){
  const dx=x2-x1, dz=z2-z1, len=Math.hypot(dx,dz);
  if(len < 0.05) return;
  const ang = Math.atan2(dx,dz);
  const ux=dx/len, uz=dz/len, nx=uz, nz=-ux;
  // проёмы задаются центром вдоль стены (от точки 1)
  const ops = (opt.openings||[]).map(o=>({...o, t0:o.at-o.w/2, t1:o.at+o.w/2, y1:Math.min(o.y1, h-0.2)}))
                                 .sort((a,b)=>a.t0-b.t0);
  const P = (t,n,y)=> new THREE.Vector3(x1+ux*t+nx*n, y, z1+uz*t+nz*n);
  const wallQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), ang);
  const plate = (t0,t1,yc,sy)=>{
    const L=t1-t0; if(L<=0.02) return; const c=P(t0+L/2,0,yc);
    const g=new THREE.BoxGeometry(TH*0.98,sy,L); uvBox(g,TH,sy,L,0.9,true);
    g.applyMatrix4(_m4.compose(c, wallQ, new THREE.Vector3(1,1,1))); bucket('wood').push(g);
  };
  // нижняя обвязка прерывается в дверях — порога нет
  let cur = 0;
  for(const o of ops){ if(o.y0 < 0.05){ plate(cur, o.t0-0.001, y0+0.044, 0.088); cur = o.t1+0.001; } }
  plate(cur, len, y0+0.044, 0.088);
  plate(0, len, y0+h-0.044, 0.088);
  plate(0, len, y0+h-0.132, 0.088);
  const inOp = (t, pad=0.06)=> ops.some(o=> t > o.t0-pad && t < o.t1+pad);
  const studH0 = y0+0.088, studH1 = y0+h-0.176;
  const studs = [];
  const stud = (t, y0s=studH0, y1s=studH1, hp=220)=>{
    if(y1s - y0s < 0.1) return;
    createBeam({a:P(t,0,y0s), b:P(t,0,y1s), sx:STUD*1.9, sy:TH*0.98, side:new THREE.Vector3(ux,0,uz), hp, mat:'wood'});
  };
  for(let t=STUD; t<=len-STUD+0.001; t+=STEP){
    const tt = Math.min(t, len-STUD);
    if(inOp(tt)) continue;
    stud(tt); studs.push(tt);
  }
  if(!studs.length || len-studs[studs.length-1] > 0.2){ if(!inOp(len-STUD)) { stud(len-STUD); studs.push(len-STUD); } }
  for(const o of ops){
    // стойки у проёма: основная + подкосная под перемычкой
    stud(o.t0-STUD); stud(o.t1+STUD);
    stud(o.t0-STUD*3, studH0, y0+o.y1, 180); stud(o.t1+STUD*3, studH0, y0+o.y1, 180);
    studs.push(o.t0-STUD, o.t1+STUD);
    // перемычка над проёмом
    createBeam({a:P(o.t0-STUD*4,0,y0+o.y1+0.1), b:P(o.t1+STUD*4,0,y0+o.y1+0.1), sx:TH*0.98, sy:0.2,
                side:new THREE.Vector3(nx,0,nz), hp:320, mat:'wood'});
    // короткие стойки над перемычкой
    for(let t=o.t0+0.2; t<o.t1-0.1; t+=STEP) stud(t, y0+o.y1+0.2, studH1, 150);
    if(o.y0 > 0.05){
      createBeam({a:P(o.t0,0,y0+o.y0-0.04), b:P(o.t1,0,y0+o.y0-0.04), sx:TH*0.98, sy:0.08,
                  side:new THREE.Vector3(nx,0,nz), hp:160, mat:'wood'});
      for(let t=o.t0+0.2; t<o.t1-0.1; t+=STEP) stud(t, studH0, y0+o.y0-0.08, 120);
    }
    // наличник и обкладка проёма: откосы закрыты доской, не торчит каркас
    const jt = TH + SHEET*2 + 0.004;
    for(const tt of [o.t0-0.012, o.t1+0.012]){
      const c = P(tt, 0, y0+(o.y0+o.y1)/2);
      addBox('wood', c.x, c.y, c.z, Math.abs(ux)>0.5?0.024:jt, o.y1-o.y0, Math.abs(ux)>0.5?jt:0.024,
             {collide:false, d:1.2, tint:[0.92,0.86,0.76]});
    }
    { const c = P((o.t0+o.t1)/2, 0, y0+o.y1+0.012);
      addBox('wood', c.x, c.y, c.z, Math.abs(ux)>0.5?o.w+0.05:jt, 0.024, Math.abs(ux)>0.5?jt:o.w+0.05, {collide:false, d:1.2, tint:[0.92,0.86,0.76]}); }
    if(o.y0 > 0.05){
      const c = P((o.t0+o.t1)/2, 0, y0+o.y0-0.012);
      addBox('wood', c.x, c.y, c.z, Math.abs(ux)>0.5?o.w+0.1:jt+0.06, 0.03, Math.abs(ux)>0.5?jt+0.06:o.w+0.1, {collide:false, d:1.2, tint:[0.9,0.84,0.74]});
      if(o.glass) windowGlass(P((o.t0+o.t1)/2, 0, y0+(o.y0+o.y1)/2), ang, o.w, o.y1-o.y0);
    }
    // порог двери 2 этажа закрывает щель между полами соседних пролётов
    if(o.door && y0 > 1){ const c = P((o.t0+o.t1)/2, 0, y0-0.012);
      addBox('wood', c.x, c.y, c.z, Math.abs(ux)>0.5?o.w:TH+0.12, 0.03, Math.abs(ux)>0.5?TH+0.12:o.w, {d:1.1, tint:[0.85,0.8,0.7]}); }
    if(o.door) DOORS.push({x:(P((o.t0+o.t1)/2,0,0)).x, z:(P((o.t0+o.t1)/2,0,0)).z, y:y0, ang, w:o.w});
  }
  // ригель между стойками — только вне проёмов
  if(h > 2.6){
    studs.sort((a,b)=>a-b);
    for(let i=0;i<studs.length-1;i++){
      const a = studs[i]+STUD, b = studs[i+1]-STUD;
      if(b-a < 0.05) continue;
      const mid = (a+b)/2, yb = y0+h*0.5;
      if(ops.some(o=> mid > o.t0-0.05 && mid < o.t1+0.05 && yb > y0+o.y0-0.1 && yb < y0+o.y1+0.25)) continue;
      plate(a, b, yb, 0.088);
    }
  }
  // обшивка: прямоугольники вокруг проёмов, резка на листы 1.22 x 2.44
  const rects=[]; cur=0;
  for(const o of ops){
    if(o.t0-cur>0.02) rects.push([cur,o.t0,0,h]);
    if(o.y0>0.02) rects.push([o.t0,o.t1,0,o.y0]);
    if(h-o.y1>0.02) rects.push([o.t0,o.t1,o.y1,h]);
    cur=o.t1;
  }
  if(len-cur>0.02) rects.push([cur,len,0,h]);
  const sides = opt.sheath==='none' ? [] : (opt.sheath==='one' ? [opt.side??1] : [1,-1]);
  const CH = Q.tex >= 0.75 ? 0.41 : 0.6;        // размер куска разрушения
  const trim = TH/2 + SHEET;
  for(const s of sides){
    const outer = opt.outSide === s;
    const T0 = outer ? -trim : (opt.trim0 === false ? 0 : trim);
    const T1 = outer ? len+trim : len - (opt.trim1 === false ? 0 : trim);
    const nOff = s*(TH/2+SHEET/2);
    const N = new THREE.Vector3(nx*s,0,nz*s);
    const Vv = new THREE.Vector3(0,1,0);
    const U = new THREE.Vector3().crossVectors(Vv, N);
    for(let [t0,t1,ry0,ry1] of rects){
      t0 = Math.max(t0, T0); t1 = Math.min(t1, T1);
      if(t0 <= 0.001 && T0 < 0 && rects[0][0] === 0) t0 = T0;
      if(t1 >= len-0.001 && T1 > len) t1 = T1;
      const L=t1-t0, Hh=ry1-ry0; if(L<0.05||Hh<0.05) continue;
      const SW=1.22, SH=2.44, GAP=0.004;
      const cols=Math.max(1,Math.ceil(L/SW-0.05)), rows=Math.max(1,Math.ceil(Hh/SH-0.05));
      const cw=L/cols, chh=Hh/rows;
      for(let ci=0;ci<cols;ci++) for(let ri=0;ri<rows;ri++){
        const lt0=t0+ci*cw+GAP/2, ltW=cw-GAP, ly0=ry0+ri*chh+GAP/2, lhH=chh-GAP;
        if(ltW<0.04||lhH<0.04) continue;
        const c = P(lt0+ltW/2, nOff, y0+ly0+lhH/2);
        const t0c = sr(0.84,1.05), warm = sr(0.95,1.03);
        createSheet({c, U, V:Vv, w:ltW, h:lhH, t:SHEET, nu:Math.max(1,Math.round(ltW/CH)), nv:Math.max(1,Math.round(lhH/CH)),
          mat: srnd()<0.5?'osb':'osb2', tint:[t0c*warm, t0c*sr(0.97,1.01), t0c*sr(0.9,1.0)],
          colDepth: TH/2+SHEET, hp: 100, kind:'wall'});
      }
    }
  }
  WALLS.push({x1,z1,x2,z2,y0,h, ops, len, ang, nx, nz, sheath:opt.sheath||'both'});
}
/** Остекление окна: рама + разрушаемое стекло. */
function windowGlass(c, ang, w, h){
  const g = new THREE.PlaneGeometry(w-0.04, h-0.04);
  const m = new THREE.Mesh(g, M.glass);
  m.position.copy(c); m.rotation.y = ang + Math.PI/2;
  m.userData.glass = {w:w-0.04, h:h-0.04}; m.userData.nomerge = true;
  scene.add(m);
  registerGlass(m, {hp:1, playerCollide:true});
}

/* ============================================================================
   ПЕРЕКРЫТИЕ: лаги (разрушаемый брус) + черновой пол из листов-кусков.
   Лаги опираются на стены по линиям z = ±9.5, ±1.3/±3.5.
============================================================================ */
function floorRect(x0,z0,x1,z1){
  // лаги вдоль z с шагом 0.61
  const yT = H1 + JOIST/2 + 0.001;
  for(let x = x0+0.1; x <= x1-0.05; x += STEP){
    createBeam({a:new THREE.Vector3(x, yT, z0+0.02), b:new THREE.Vector3(x, yT, z1-0.02), sx:0.045, sy:JOIST,
                side:new THREE.Vector3(1,0,0), hp:340, mat:'wood', tint:[0.95,0.92,0.86]});
  }
  // обвязочные балки по краям
  for(const x of [x0+0.025, x1-0.025])
    addBox('wood', x, yT, (z0+z1)/2, 0.045, JOIST, z1-z0, {collide:false, d:.9, grain:true});
  // черновой пол листами 1.22 (x) x 2.44 (z)
  const CH = Q.tex >= 0.75 ? 0.41 : 0.61;
  const U = new THREE.Vector3(1,0,0), Vv = new THREE.Vector3(0,0,-1);
  const cols = Math.max(1, Math.ceil((x1-x0)/1.22 - 0.05)), rows = Math.max(1, Math.ceil((z1-z0)/2.44 - 0.05));
  const cw = (x1-x0)/cols, rh = (z1-z0)/rows;
  for(let i=0;i<cols;i++) for(let j=0;j<rows;j++){
    const w = cw-0.003, h = rh-0.003;
    const c = new THREE.Vector3(x0 + (i+0.5)*cw, F2 - SUBF/2, z0 + (j+0.5)*rh);
    const tt = sr(0.8, 0.92);
    createSheet({c, U, V:Vv, w, h, t:SUBF, nu:Math.max(1,Math.round(w/CH)), nv:Math.max(1,Math.round(h/CH)),
      mat:'osb2', tint:[tt, tt*0.98, tt*0.93], colDepth:0.06, hp:140, kind:'floor', uvd:0.82});
  }
}
function floorWithHoles(x0,z0,x1,z1, holes){
  let rects=[[x0,z0,x1,z1]];
  for(const [hx0,hz0,hx1,hz1] of holes){
    const next=[];
    for(const [ax0,az0,ax1,az1] of rects){
      const ox0=Math.max(ax0,hx0), oz0=Math.max(az0,hz0), ox1=Math.min(ax1,hx1), oz1=Math.min(az1,hz1);
      if(ox0>=ox1||oz0>=oz1){ next.push([ax0,az0,ax1,az1]); continue; }
      if(az0<oz0) next.push([ax0,az0,ax1,oz0]);
      if(oz1<az1) next.push([ax0,oz1,ax1,az1]);
      if(ax0<ox0) next.push([ax0,oz0,ox0,oz1]);
      if(ox1<ax1) next.push([ox1,oz0,ax1,oz1]);
    }
    rects=next;
  }
  for(const [a,b,c,d] of rects) if(c-a > 0.2 && d-b > 0.2) floorRect(a,b,c,d);
}

/* ============================================================================
   ПЕРИЛА И ОГРАЖДЕНИЯ
============================================================================ */
/** Деревянное ограждение: стойки, поручень, средняя перекладина + коллайдер-стенка. */
export function woodRail(x1,z1,x2,z2, y, h=1.05, opt={}){
  const len=Math.hypot(x2-x1,z2-z1); if(len<0.1) return;
  const ux=(x2-x1)/len, uz=(z2-z1)/len;
  const n=Math.max(1,Math.round(len/1.2));
  for(let i=0;i<=n;i++){
    const t=i*len/n;
    createBeam({a:new THREE.Vector3(x1+ux*t, y, z1+uz*t), b:new THREE.Vector3(x1+ux*t, y+h, z1+uz*t), sx:0.07, sy:0.07, hp:160, collide:false});
  }
  for(const [yy,sz] of [[y+h-0.03,0.07],[y+h*0.5,0.045]])
    createBeam({a:new THREE.Vector3(x1,yy,z1), b:new THREE.Vector3(x2,yy,z2), sx:sz, sy:0.035, hp:90, collide:false, noPlayer:true});
  // игрок упирается в перила, пули и обломки проходят
  addOBB((x1+x2)/2, y+h/2, (z1+z2)/2, Math.abs(ux)>0.5?len:0.1, h, Math.abs(ux)>0.5?0.1:len, null, 'wood', {playerOnly:true});
}
/** Стальное ограждение площадок и мостков. */
export function steelRail(x1,z1,x2,z2, y, h=1.08){
  const len=Math.hypot(x2-x1,z2-z1); if(len<0.1) return;
  const ux=(x2-x1)/len, uz=(z2-z1)/len;
  const n=Math.max(1,Math.round(len/1.3));
  for(let i=0;i<=n;i++){ const t=i*len/n;
    addBox('steel', x1+ux*t, y+h/2, z1+uz*t, 0.045, h, 0.045, {collide:false, d:1}); }
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  for(const yy of [y+h-0.02, y+h*0.52]){
    beamBetween('steel', A.set(x1,yy,z1), B.set(x2,yy,z2), 0.042, 0.042, {d:1});
  }
  beamBetween('steel', A.set(x1,y+0.06,z1), B.set(x2,y+0.06,z2), 0.012, 0.11, {d:1});
  addOBB((x1+x2)/2, y+h/2, (z1+z2)/2, Math.abs(ux)>0.5?len:0.08, h, Math.abs(ux)>0.5?0.08:len, null, 'metal', {playerOnly:true});
}

/* ============================================================================
   ВНУТРЕННЯЯ ДЕРЕВЯННАЯ ЛЕСТНИЦА
   Косоуры — выпиленные «гребёнкой» доски 2x12, проступи с выносом, подступенки
   из OSB, поручень на стойках с открытой стороны и на кронштейнах у стены.
   Коллайдер — наклонная плита по носкам ступеней: персонаж идёт плавно, а
   под высокой частью марша остаётся свободный проход.
============================================================================ */
function woodStairs(x0, x1, zBot, dir, y0, y1, run, wallSide){
  const rise = y1 - y0, n = Math.max(12, Math.round(rise/0.183)), r = rise/n, tr = run/n;
  const width = x1 - x0, xc = (x0+x1)/2;
  const Z = s => zBot + dir*s;
  // ступени
  for(let i=0;i<n;i++){
    const s0 = i*tr, yTop = y0 + r*(i+1);
    const zc = Z(s0 + tr/2) ;
    addBox('wood', xc, yTop-0.016, zc - dir*0.012, width-0.02, 0.032, tr+0.03, {collide:false, d:1.1, grain:true, tint:[0.98,0.93,0.84]});
    // подступенок
    addBox('osb2', xc, yTop - r/2 - 0.016, Z(s0) + dir*0.006, width-0.08, r-0.03, 0.012, {collide:false, d:.8});
  }
  // косоуры: пилёный профиль
  for(const x of [x0+0.022, x1-0.022]){
    const sh = new THREE.Shape();
    const depth = 0.29;
    sh.moveTo(0, 0);
    for(let i=0;i<n;i++){ sh.lineTo(i*tr, (i+1)*r - 0.032); sh.lineTo((i+1)*tr, (i+1)*r - 0.032); }
    const L = Math.hypot(run, rise), cs = run/L, sn = rise/L;
    sh.lineTo(run, rise - 0.032 - depth/cs*0.9);
    sh.lineTo(depth*sn*0.9, 0);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, {depth:0.038, bevelEnabled:false});
    // профиль рисуется в плоскости (s, y); переводим в мир: s → z по направлению марша
    g.translate(0,0,-0.019);
    const m = new THREE.Matrix4();
    m.makeBasis(new THREE.Vector3(0,0,dir), new THREE.Vector3(0,1,0), new THREE.Vector3(dir,0,0).negate());
    g.applyMatrix4(m);
    g.translate(x, y0, zBot);
    const uv = g.attributes.uv; for(let i=0;i<uv.count;i++) uv.setXY(i, uv.getX(i)*0.9, uv.getY(i)*0.9);
    tintGeo(g, 0.95, 0.9, 0.82);
    bucket('wood').push(g);
  }
  // коллайдер: наклонная плита по носкам
  const L = Math.hypot(run, rise), ang = Math.atan2(rise, run);
  const thick = 0.12;
  const mid = new THREE.Vector3(xc, y0 + rise/2 - thick/2*Math.cos(ang), zBot + dir*(run/2) + dir*thick/2*Math.sin(ang));
  mid.z -= dir*tr/2;                 // плита проходит через середины проступей
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(dir>0 ? -ang : ang, 0, 0));
  addOBB(mid.x, mid.y, mid.z, width, thick, L, q, 'wood');
  // короткая площадка схода внизу, чтобы носок первой ступени не цеплял капсулу
  // ограждение открытой стороны марша и поручень у стены
  const open = wallSide < 0 ? x1 : x0, wallX = wallSide < 0 ? x0+0.06 : x1-0.06;
  const posts = 3;
  for(let i=0;i<=posts;i++){
    const s = i*run/posts, yb = y0 + rise*(s/run) + (i===0?0:0);
    createBeam({a:new THREE.Vector3(open, yb, Z(s)), b:new THREE.Vector3(open, yb+1.0+(i===0?0.15:0), Z(s)), sx:0.07, sy:0.07, hp:150, collide:false});
  }
  const hr0 = new THREE.Vector3(open, y0+0.95, Z(0)), hr1 = new THREE.Vector3(open, y1+0.95, Z(run));
  beamBetween('wood', hr0, hr1, 0.06, 0.045, {d:1, tint:[0.9,0.82,0.7]});
  beamBetween('wood', hr0.clone().setY(y0+0.5), hr1.clone().setY(y1+0.5), 0.04, 0.03, {d:1});
  beamBetween('dark', new THREE.Vector3(wallX, y0+0.9, Z(0.2)), new THREE.Vector3(wallX, y1+0.9, Z(run-0.2)), 0.04, 0.04, {d:1});
  for(let i=0;i<4;i++){ const s = 0.4 + i*(run-0.8)/3;
    addBox('dark', wallX + (wallSide<0?-0.03:0.03), y0 + rise*(s/run) + 0.85, Z(s), 0.07, 0.03, 0.03, {collide:false}); }
  // стенка-ограждение марша для персонажа (по наклону)
  const q2 = q.clone();
  addOBB(open, mid.y + 0.55, mid.z, 0.08, 1.0, L, q2, 'wood', {playerOnly:true});
}

/* ============================================================================
   НАРУЖНАЯ СТАЛЬНАЯ ЛЕСТНИЦА: швеллерные косоуры, решётчатые ступени с
   уголком-носком, площадка на стойках с раскосами, перила с бортовой доской.
============================================================================ */
function steelStair(xc, zFace, out, y1){
  // out: +1 — фасад смотрит в +z (юг), -1 — в -z (север)
  const W = 1.2, n = Math.round(y1/0.19), r = y1/n, tr = RUN_OUT/n;
  const zP0 = zFace + out*0.09, zP1 = zFace + out*(0.09+PLAT_D);   // площадка
  const x0 = xc - PLAT_W/2, x1 = xc + PLAT_W/2;
  // площадка: решётчатый настил в обвязке
  const pzc = (zP0+zP1)/2;
  addBox('grating', xc, y1-0.02, pzc, PLAT_W, 0.04, PLAT_D, {collide:false, d:1.4});
  addOBB(xc, y1-0.06, pzc, PLAT_W, 0.12, PLAT_D, null, 'metal');
  for(const zz of [zP0+out*0.04, zP1-out*0.04]) addBox('steel', xc, y1-0.12, zz, PLAT_W, 0.18, 0.08, {collide:false, d:1});
  for(const xx of [x0+0.04, x1-0.04]) addBox('steel', xx, y1-0.12, pzc, 0.08, 0.18, PLAT_D, {collide:false, d:1});
  // стойки площадки (у фасада и снаружи) с раскосами
  for(const xx of [x0+0.06, x1-0.06]) for(const zz of [zP0+out*0.06, zP1-out*0.06]){
    addBox('steel', xx, (y1-0.2)/2, zz, 0.1, y1-0.2, 0.1, {d:1.1});
    addBox('dark', xx, 0.02, zz, 0.26, 0.04, 0.26, {collide:false});
  }
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  for(const zz of [zP0+out*0.06, zP1-out*0.06]){
    beamBetween('steel', A.set(x0+0.06, 0.3, zz), B.set(x1-0.06, y1-0.35, zz), 0.05, 0.05, {d:1});
  }
  // марш: выход на площадку с её наружного края, спуск от фасада
  const zS0 = zP1, zS1 = zP1 + out*RUN_OUT;
  const sx0 = xc - W/2, sx1 = xc + W/2;
  for(let i=0;i<n-1;i++){
    const yTop = y1 - r*(i+1);
    const zc = zS0 + out*(tr*(i+0.5) + tr*0.5);
    addBox('grating', xc, yTop-0.018, zc, W-0.06, 0.036, tr+0.02, {collide:false, d:1.6});
    addBox('steel', xc, yTop-0.03, zc - out*(tr/2), W-0.06, 0.06, 0.035, {collide:false, d:1});      // уголок-носок
  }
  const L = Math.hypot(RUN_OUT, y1), ang = Math.atan2(y1, RUN_OUT);
  // косоуры-швеллеры
  for(const x of [sx0-0.03, sx1+0.03]){
    const a = new THREE.Vector3(x, y1-0.12, zS0), b = new THREE.Vector3(x, -0.05, zS1);
    beamBetween('steel', a, b, 0.05, 0.22, {d:1.2});
    beamBetween('dark', a.clone().setY(a.y+0.1).setX(x + (x<xc?-0.03:0.03)), b.clone().setY(b.y+0.1).setX(x + (x<xc?-0.03:0.03)), 0.06, 0.02, {d:1});
    beamBetween('dark', a.clone().setY(a.y-0.1).setX(x + (x<xc?-0.03:0.03)), b.clone().setY(b.y-0.1).setX(x + (x<xc?-0.03:0.03)), 0.06, 0.02, {d:1});
    addBox('dark', x, 0.03, zS1 - out*0.1, 0.2, 0.06, 0.3, {collide:false});
  }
  // коллайдер марша — наклонная плита
  const thick = 0.12;
  const mid = new THREE.Vector3(xc, y1/2 - thick/2*Math.cos(ang), (zS0+zS1)/2 - out*thick/2*Math.sin(ang));
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(out>0 ? ang : -ang, 0, 0));
  addOBB(mid.x, mid.y, mid.z, W, thick, L, q, 'metal');
  // перила марша (стойки по наклону + поручень) и стенка-ограничитель
  for(const x of [sx0-0.02, sx1+0.02]){
    for(let i=0;i<=4;i++){ const s = i*RUN_OUT/4, yb = y1 - y1*(s/RUN_OUT);
      addBox('steel', x, yb+0.52, zS0 + out*s, 0.045, 1.04, 0.045, {collide:false, d:1}); }
    beamBetween('steel', A.set(x, y1+1.02, zS0), B.set(x, 1.02, zS1), 0.045, 0.045, {d:1});
    beamBetween('steel', A.set(x, y1+0.52, zS0), B.set(x, 0.52, zS1), 0.035, 0.035, {d:1});
    addOBB(x, mid.y+0.6, mid.z, 0.08, 1.1, L, q, 'metal', {playerOnly:true});
  }
  // ограждение площадки: боковые стороны и наружная часть мимо марша
  steelRail(x0, zP0, x0, zP1, y1); steelRail(x1, zP0, x1, zP1, y1);
  steelRail(x0, zP1, sx0-0.02, zP1, y1); steelRail(sx1+0.02, zP1, x1, zP1, y1);
  // промежуточная опора марша
  const zm = zS0 + out*RUN_OUT*0.55;
  addBox('steel', xc, (y1*0.45-0.2)/2, zm, 0.1, y1*0.45-0.2, 0.1, {d:1.1});
  addBox('steel', xc, y1*0.45-0.22, zm, W+0.1, 0.08, 0.08, {collide:false});
}

/* ============================================================================
   ПЛАНИРОВКА
============================================================================ */
export function buildHouse(){
  const y2 = F2;
  // Фундаментная плита чуть выше пола ангара — читается граница здания
  addBox('conc', 0, 0.02, 0, BX1-BX0+0.5, 0.04, BZ1-BZ0+0.5, {collide:false, d:.4});

  /* ---------- 1 ЭТАЖ ---------- */
  // наружные стены (стены строятся от меньшей координаты к большей)
  const along = (x)=> x - BX0, alongZ = (z)=> z - BZ0;
  buildWall(BX0,BZ0, BX1,BZ0, 0,H1, {outSide:1, openings:[
    Wn(along(-14.0)), D(along(-12.1)), Wn(along(-9.0)), D(along(-5.6)), Wn(along(-2.2)),
    D(along(2.25)), Wn(along(5.6), 1.2, true), D(along(8.0)), Wn(along(11.4)), Wn(along(13.9))]});
  buildWall(BX0,BZ1, BX1,BZ1, 0,H1, {outSide:-1, openings:[
    Wn(along(-13.9)), Wn(along(-11.4)), D(along(-8.0)), Wn(along(-5.6), 1.2, true), D(along(-2.25)),
    Wn(along(2.2)), D(along(5.6)), Wn(along(9.0)), D(along(12.1)), Wn(along(14.0))]});
  buildWall(BX0,BZ0, BX0,BZ1, 0,H1, {outSide:1, openings:[Wn(alongZ(-5.4)), D(alongZ(0)), Wn(alongZ(5.4))]});
  buildWall(BX1,BZ0, BX1,BZ1, 0,H1, {outSide:-1, openings:[Wn(alongZ(-5.4)), D(alongZ(0)), Wn(alongZ(5.4))]});
  // коридоры крыльев
  buildWall(BX0,-CZ, ATR.x0,-CZ, 0,H1, {openings:[D(along(-11.3)), D(along(-7.1)), Wn(along(-5.6),0.9)]});
  buildWall(BX0, CZ, ATR.x0, CZ, 0,H1, {openings:[D(along(-12.4)), Wl(along(-9.0),1.6), D(along(-7.1))]});
  buildWall(ATR.x1,-CZ, BX1,-CZ, 0,H1, {openings:[D(along(7.1)-ATR.x1+BX0), Wl(along(9.0)-ATR.x1+BX0,1.6), D(along(12.4)-ATR.x1+BX0)]});
  buildWall(ATR.x1, CZ, BX1, CZ, 0,H1, {openings:[Wn(along(5.6)-ATR.x1+BX0,0.9), D(along(7.1)-ATR.x1+BX0), D(along(11.3)-ATR.x1+BX0)]});
  // перегородки между комнатами крыльев
  buildWall(-PX,BZ0, -PX,-CZ, 0,H1, {openings:[D(3.0), Wn(6.4)]});
  buildWall(-PX, CZ, -PX,BZ1, 0,H1, {openings:[Wn(1.8), D(5.2)]});
  buildWall( PX,BZ0,  PX,-CZ, 0,H1, {openings:[D(3.0), Wn(6.4)]});
  buildWall( PX, CZ,  PX,BZ1, 0,H1, {openings:[Wn(1.8), D(5.2)]});
  // стены атриума и центральных залов
  buildWall(ATR.x0,BZ0, ATR.x0,-CZ, 0,H1, {openings:[D(3.0), Wn(6.9, 1.0)]});
  buildWall(ATR.x0, CZ, ATR.x0,BZ1, 0,H1, {openings:[Wn(1.3, 1.0), D(5.2)]});
  buildWall(ATR.x1,BZ0, ATR.x1,-CZ, 0,H1, {openings:[D(3.0), Wn(6.9, 1.0)]});
  buildWall(ATR.x1, CZ, ATR.x1,BZ1, 0,H1, {openings:[Wn(1.3, 1.0), D(5.2)]});
  buildWall(ATR.x0,ATR.z0, ATR.x1,ATR.z0, 0,H1, {openings:[D(2.25), Wl(6.75, 2.2)]});
  buildWall(ATR.x0,ATR.z1, ATR.x1,ATR.z1, 0,H1, {openings:[Wl(2.25, 2.2), D(6.75)]});
  buildWall(0,BZ0, 0,ATR.z0, 0,H1, {openings:[D(3.0)]});
  buildWall(0,ATR.z1, 0,BZ1, 0,H1, {openings:[D(3.0)]});

  /* ---------- ПЕРЕКРЫТИЕ ---------- */
  const holes = [[ATR.x0, ATR.z0, ATR.x1, ATR.z1]];
  for(const s of STAIRS_IN){
    const zTop = s.zBot + s.dir*RUN_IN;
    holes.push([s.x0-0.1, Math.min(s.zBot, zTop)-0.05, s.x1+0.3, Math.max(s.zBot, zTop)+0.05]);
  }
  // лаги опираются на стены: делим перекрытие по линиям несущих стен
  const bands = [[BZ0,-CZ],[-CZ,CZ],[CZ,BZ1]];
  for(const [za,zb] of bands){
    floorWithHoles(BX0+0.07, za+0.07, ATR.x0, zb-0.07, holes);
    floorWithHoles(ATR.x1, za+0.07, BX1-0.07, zb-0.07, holes);
  }
  floorWithHoles(ATR.x0, BZ0+0.07, ATR.x1, ATR.z0, holes);
  floorWithHoles(ATR.x0, ATR.z1, ATR.x1, BZ1-0.07, holes);

  /* ---------- ЛЕСТНИЦЫ ---------- */
  for(const s of STAIRS_IN){
    woodStairs(s.x0, s.x1, s.zBot, s.dir, 0, y2, RUN_IN, s.x0 < 0 ? -1 : 1);
    // ограждение проёма на 2 этаже (открытая сторона вдоль марша и торец у низа)
    const zTop = s.zBot + s.dir*RUN_IN;
    const openX = s.x0 < 0 ? s.x1+0.3 : s.x0-0.3;
    woodRail(openX, s.zBot - s.dir*0.05, openX, zTop, y2);
    woodRail(s.x0 < 0 ? BX0+0.1 : openX, s.zBot - s.dir*0.05, s.x0 < 0 ? openX : BX1-0.1, s.zBot - s.dir*0.05, y2);
  }

  /* ---------- 2 ЭТАЖ ---------- */
  buildWall(BX0,BZ0, BX1,BZ0, y2,H2, {outSide:1, openings:[
    Wn(along(-13.2),1.2,true), Wn(along(-10.4)), D(along(-7.2)), Wn(along(-2.2),1.4,true),
    Wn(along(2.2)), Wn(along(7.2),1.2,true), Wn(along(10.4)), Wn(along(13.2))]});
  buildWall(BX0,BZ1, BX1,BZ1, y2,H2, {outSide:-1, openings:[
    Wn(along(-13.2)), Wn(along(-10.4)), Wn(along(-7.2),1.2,true), Wn(along(-2.2)),
    Wn(along(2.2),1.4,true), D(along(7.2)), Wn(along(10.4)), Wn(along(13.2),1.2,true)]});
  buildWall(BX0,BZ0, BX0,BZ1, y2,H2, {outSide:1, openings:[Wn(alongZ(-5.4),1.2,true), Wl(alongZ(0),1.8), Wn(alongZ(5.4))]});
  buildWall(BX1,BZ0, BX1,BZ1, y2,H2, {outSide:-1, openings:[Wn(alongZ(-5.4)), Wl(alongZ(0),1.8), Wn(alongZ(5.4),1.2,true)]});
  buildWall(BX0,-CZ, ATR.x0,-CZ, y2,H2, {openings:[D(along(-11.0)), D(along(-7.1))]});
  buildWall(BX0, CZ, ATR.x0, CZ, y2,H2, {openings:[D(along(-12.4)), Wn(along(-9.6)), D(along(-7.1))]});
  buildWall(ATR.x1,-CZ, BX1,-CZ, y2,H2, {openings:[D(along(7.1)-ATR.x1+BX0), Wn(along(9.6)-ATR.x1+BX0), D(along(12.4)-ATR.x1+BX0)]});
  buildWall(ATR.x1, CZ, BX1, CZ, y2,H2, {openings:[D(along(7.1)-ATR.x1+BX0), D(along(11.0)-ATR.x1+BX0)]});
  buildWall(-PX,BZ0, -PX,-CZ, y2,H2, {openings:[D(1.4), Wl(5.0,1.6)]});
  buildWall(-PX, CZ, -PX,BZ1, y2,H2, {openings:[D(2.6), Wn(6.2)]});
  buildWall( PX,BZ0,  PX,-CZ, y2,H2, {openings:[Wn(2.0), D(5.6)]});
  buildWall( PX, CZ,  PX,BZ1, y2,H2, {openings:[Wl(3.2,1.6), D(6.8)]});
  buildWall(ATR.x0,BZ0, ATR.x0,ATR.z0, y2,H2, {openings:[D(3.0)]});
  buildWall(ATR.x0,ATR.z1, ATR.x0,BZ1, y2,H2, {openings:[D(3.0)]});
  buildWall(ATR.x1,BZ0, ATR.x1,ATR.z0, y2,H2, {openings:[D(3.0)]});
  buildWall(ATR.x1,ATR.z1, ATR.x1,BZ1, y2,H2, {openings:[D(3.0)]});
  // залы над атриумом смотрят в него широкими проёмами
  buildWall(ATR.x0,ATR.z0, ATR.x1,ATR.z0, y2,H2, {openings:[Wl(1.6,1.8), D(4.5), Wl(7.4,1.8)]});
  buildWall(ATR.x0,ATR.z1, ATR.x1,ATR.z1, y2,H2, {openings:[Wl(1.6,1.8), D(4.5), Wl(7.4,1.8)]});
  buildWall(0,BZ0, 0,ATR.z0, y2,H2, {openings:[D(3.0)]});
  buildWall(0,ATR.z1, 0,BZ1, y2,H2, {openings:[D(3.0)]});
  // ограждение атриума вдоль торцов коридоров (балконы) и мостик через атриум
  woodRail(ATR.x0-0.02, ATR.z0+0.1, ATR.x0-0.02, -1.0, y2); woodRail(ATR.x0-0.02, 1.0, ATR.x0-0.02, ATR.z1-0.1, y2);
  woodRail(ATR.x1+0.02, ATR.z0+0.1, ATR.x1+0.02, -1.0, y2); woodRail(ATR.x1+0.02, 1.0, ATR.x1+0.02, ATR.z1-0.1, y2);
  catwalk(ATR.x0, ATR.x1, y2);
  // открытые ригели кровли над крыльями: полосы света и тени по комнатам
  for(let x = BX0+0.6; x < BX1-0.3; x += 1.22){
    if(x > ATR.x0-0.3 && x < ATR.x1+0.3) continue;
    addBox('wood', x, y2+H2+0.12, 0, 0.045, 0.24, BZ1-BZ0, {collide:false, d:.9, grain:true, tint:[0.9,0.86,0.78]});
  }

  /* ---------- НАРУЖНЫЕ ЛЕСТНИЦЫ ---------- */
  for(const s of STAIRS_OUT){
    const out = s.side==='n' ? -1 : 1;
    steelStair(s.x, s.side==='n' ? BZ0 : BZ1, out, y2);
    exitSign(s.x, y2+2.4, (s.side==='n'?BZ0:BZ1) + out*0.1, s.side==='n' ? Math.PI : 0);
  }
  for(const d of DOORS){
    if(d.y > 1) continue;
    if(Math.abs(Math.abs(d.z) - BZ1) < 0.01) exitSign(d.x, 2.35, d.z + Math.sign(d.z)*0.1, d.z < 0 ? Math.PI : 0);
    if(Math.abs(Math.abs(d.x) - BX1) < 0.01) exitSign(d.x + Math.sign(d.x)*0.1, 2.35, d.z, d.x < 0 ? -Math.PI/2 : Math.PI/2);
  }
  buildInteriorLamps();
}
/** Мостик через атриум: решётка на двутаврах, стальное ограждение. */
function catwalk(x0, x1, y){
  const w = 1.5;
  addBox('grating', 0, y-0.02, 0, x1-x0, 0.04, w, {collide:false, d:1.4});
  addOBB(0, y-0.06, 0, x1-x0, 0.12, w, null, 'metal');
  for(const z of [-w/2+0.05, w/2-0.05]) addBox('steel', 0, y-0.16, z, x1-x0, 0.26, 0.09, {collide:false, d:1});
  steelRail(x0, -w/2, x1, -w/2, y); steelRail(x0, w/2, x1, w/2, y);
  // подвесы к ригелям: мостик не висит в воздухе
  for(const x of [-2.2, 2.2]) for(const z of [-w/2, w/2]) addBox('steel', x, y+(H2)/2+0.1, z, 0.03, H2, 0.03, {collide:false});
  // двутавры над атриумом, на которых висит мостик, опираются на стены залов
  for(const x of [-2.2, 2.2]){
    addBox('steel', x, y+H2+0.12, 0, 0.12, 0.24, ATR.z1-ATR.z0+0.3, {collide:false, d:1});
    addBox('steel', x, y+H2+0.12, 0, 0.02, 0.2, ATR.z1-ATR.z0+0.3, {collide:false, d:1});
  }
}
/** Переносные лампы под потолком комнат: лампа на проводе + свет из общего пула. */
export const INTERIOR = [];
function buildInteriorLamps(){
  const bulbMat = new THREE.MeshStandardMaterial({color:0xfff1d6, emissive:0xffd9a0, emissiveIntensity:2.6});
  const spots = [
    [-12.4,-5.2,0], [-7.1,-5.4,0], [-12.4,5.4,0], [-7.1,5.4,0], [-10,0,0], [10,0,0],
    [12.4,5.2,0], [7.1,5.4,0], [12.4,-5.4,0], [7.1,-5.4,0], [-2.2,-6.5,0], [2.2,6.5,0], [2.2,-6.5,0], [-2.2,6.5,0],
    [-12.0,-5.0,1], [-7.1,-5.4,1], [-12.2,5.5,1], [-7.1,5.4,1], [12.0,5.0,1], [7.1,5.4,1], [12.2,-5.5,1], [7.1,-5.4,1],
    [-2.2,-6.4,1], [2.2,6.4,1], [2.4,-6.4,1], [-2.4,6.4,1]
  ];
  for(const [x,z,fl] of spots){
    const top = fl ? F2 + H2 + 0.05 : H1;
    const y = top - (fl ? 1.1 : 0.55);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006, top-y, 4), M.cable);
    cord.position.set(x, (top+y)/2, z); cord.userData.nomerge = true; scene.add(cord);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.14, 14, 1, true), cmat(0x3a3c3a,{roughness:.6, metalness:.5, side:THREE.DoubleSide}));
    shade.position.set(x, y, z); shade.userData.nomerge = true; scene.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), bulbMat);
    bulb.position.set(x, y-0.06, z); bulb.userData.nomerge = true; scene.add(bulb);
    INTERIOR.push({pos:new THREE.Vector3(x, y-0.1, z), top, cord, shade, bulb, ax:0, az:0, vx:0, vz:0, len: top-y, x, z, alive:true});
  }
}
