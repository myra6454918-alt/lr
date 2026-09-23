// Команды: флаги на мачтах (ткань Bullet), точки возрождения, миникарта
// для выбора точки, ветер в ангаре.
import { THREE, clamp } from './engine.js';
import { M } from './materials.js';
import { makeFlagCloth } from './physics.js';
import { TEAMS } from './layout.js';
import { COLLIDERS } from './builder.js';
import { WALLS, BX0, BX1, BZ0, BZ1, STAIRS_OUT } from './house.js';
import { HW, HD } from './hangar.js';
import { scene } from './engine.js';

export const FLAGS = [];
/** Порывистый сквозняк: из щелей ворот за базами и проёмов кровли. */
export const WIND = { dir: new THREE.Vector3(0.2,0,1).normalize(), base: 6.5, vec: new THREE.Vector3(), speed: 6.5 };
export function updateWind(t){
  const gust = 0.62 + 0.42*Math.sin(t*0.23) + 0.22*Math.sin(t*0.91 + 1.7) + 0.14*Math.sin(t*2.7 + 0.4);
  WIND.speed = WIND.base * clamp(gust, 0.2, 1.85);
  const yaw = 0.5*Math.sin(t*0.11) + 0.2*Math.sin(t*0.47 + 2.1);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  WIND.vec.set(WIND.dir.x*c - WIND.dir.z*s, 0.08*Math.sin(t*0.31), WIND.dir.x*s + WIND.dir.z*c).normalize().multiplyScalar(WIND.speed);
}
export function buildFlags(){
  for(const key of ['ALPHA','DELTA']){
    const T = TEAMS[key];
    const top = new THREE.Vector3(T.flag.x, 8.15, T.flag.z);
    const along = new THREE.Vector3(0,0,1);
    const nx = 26, ny = 16;
    const f = makeFlagCloth(key==='ALPHA' ? M.flagAlpha : M.flagDelta, top, along, 2.6, 1.62, nx, ny);
    scene.add(f.mesh);
    f.team = key;
    FLAGS.push(f);
  }
}

/* ---------------------------------------------------------------------------
   МИНИКАРТА: вид сверху, рисуется из коллайдеров и стен здания.
--------------------------------------------------------------------------- */
export function drawMinimap(cv, team, selected, player){
  const x = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const s = Math.min(W/(HW*2+4), H/(HD*2+4));
  const P = (wx, wz)=> [W/2 + wx*s, H/2 + wz*s];
  x.clearRect(0,0,W,H);
  x.fillStyle = 'rgba(18,20,22,0.92)'; x.fillRect(0,0,W,H);
  // пол ангара
  const [a0,b0] = P(-HW,-HD);
  x.fillStyle = '#2a2c2e'; x.fillRect(a0, b0, HW*2*s, HD*2*s);
  x.strokeStyle = '#55595c'; x.lineWidth = 2; x.strokeRect(a0, b0, HW*2*s, HD*2*s);
  // укрытия и техника — низкие коллайдеры
  x.fillStyle = 'rgba(120,124,118,0.55)';
  for(const c of COLLIDERS){
    if(c.playerOnly || c.y0 > 2.5 || c.y1 < 0.4) continue;
    if(c.x1 - c.x0 > 30 || c.z1 - c.z0 > 30) continue;
    if(Math.abs(c.cx) < 15.3 && Math.abs(c.cz) < 9.8) continue;
    const [px,pz] = P(c.x0, c.z0);
    x.fillRect(px, pz, Math.max(1,(c.x1-c.x0)*s), Math.max(1,(c.z1-c.z0)*s));
  }
  // здание: плита и стены 1 этажа
  const [h0,h1] = P(BX0, BZ0);
  x.fillStyle = 'rgba(160,130,90,0.22)'; x.fillRect(h0, h1, (BX1-BX0)*s, (BZ1-BZ0)*s);
  x.strokeStyle = '#c9a774'; x.lineWidth = 1.5;
  for(const w of WALLS){
    if(w.y0 > 1) continue;
    let t = 0;
    const seg = (t0,t1)=>{ if(t1-t0 < 0.05) return; const ux=(w.x2-w.x1)/w.len, uz=(w.z2-w.z1)/w.len;
      const [p0,q0] = P(w.x1+ux*t0, w.z1+uz*t0), [p1,q1] = P(w.x1+ux*t1, w.z1+uz*t1);
      x.beginPath(); x.moveTo(p0,q0); x.lineTo(p1,q1); x.stroke(); };
    for(const o of w.ops){ if(o.y0 < 0.05){ seg(t, o.t0); t = o.t1; } }
    seg(t, w.len);
  }
  for(const st of STAIRS_OUT){
    const z0 = st.side==='n' ? BZ0-1.9 : BZ1+1.9, z1 = st.side==='n' ? BZ0-7.3 : BZ1+7.3;
    const [p0,q0] = P(st.x-0.6, Math.min(z0,z1)); x.fillStyle = 'rgba(150,160,170,0.5)'; x.fillRect(p0, q0, 1.2*s, Math.abs(z1-z0)*s);
  }
  // флаги и точки
  for(const key of ['ALPHA','DELTA']){
    const T = TEAMS[key];
    const [fx, fz] = P(T.flag.x, T.flag.z);
    x.fillStyle = T.color; x.beginPath(); x.moveTo(fx, fz-10); x.lineTo(fx+9, fz-6); x.lineTo(fx, fz-2); x.fill();
    x.fillRect(fx-1, fz-10, 2, 12);
    for(const sp of T.spawns){
      const [px, pz] = P(sp.x, sp.z);
      const mine = key === team, sel = selected && sel_id(selected) === sp.id;
      x.globalAlpha = mine ? 1 : 0.35;
      x.beginPath(); x.arc(px, pz, sel ? 11 : 8, 0, 7);
      x.fillStyle = sel ? T.color : 'rgba(0,0,0,0.6)'; x.fill();
      x.lineWidth = 2; x.strokeStyle = T.color; x.stroke();
      x.fillStyle = sel ? '#101214' : T.color; x.font = '700 10px ui-monospace,monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(sp.id, px, pz+0.5);
      x.globalAlpha = 1;
      sp._px = px; sp._pz = pz;
    }
  }
  if(player){
    const [px, pz] = P(player.x, player.z);
    x.save(); x.translate(px, pz); x.rotate(-player.yaw);
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(0,-7); x.lineTo(5,5); x.lineTo(0,2); x.lineTo(-5,5); x.fill(); x.restore();
  }
  x.fillStyle = '#8b8f94'; x.font = '600 11px system-ui,sans-serif'; x.textAlign = 'left';
  x.fillText('С', W/2-4, 12);
}
const sel_id = s => typeof s === 'string' ? s : s.id;
export function spawnFromClick(team, px, pz){
  let best = null, bd = 18*18;
  for(const sp of TEAMS[team].spawns){ const d = (sp._px-px)**2 + (sp._pz-pz)**2; if(d < bd){ bd = d; best = sp; } }
  return best;
}
