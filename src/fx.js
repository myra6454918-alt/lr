// Эффекты: частицы (пламя, дым, пыль, искры), щепа и крошка, декали, воронки,
// вспышки света и процедурный звук WebAudio с реверберацией ангара.
import { THREE, scene, camera, Q, clamp, lerp, rnd } from './engine.js';
import { M, FX } from './materials.js';

/* ============================================================================
   ЧАСТИЦЫ-БИЛБОРДЫ
   Инстансированные квады: одна отрисовка на систему. Симуляция на CPU,
   живые частицы упакованы в начало буфера, count = числу живых.
============================================================================ */
const QUAD = (()=>{
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-.5,-.5,0, .5,-.5,0, .5,.5,0, -.5,.5,0]),3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0,0, 1,0, 1,1, 0,1]),2));
  g.setIndex([0,1,2, 0,2,3]);
  return g;
})();
export const FXU = { uAmb:{value:new THREE.Color(1,1,1)} };   // освещённость дыма (день/ночь)
export class Particles {
  constructor({tex, max=500, additive=false, lit=false, soft=1.0, stretch=false}){
    this.max = max; this.n = 0;
    const g = QUAD.clone();
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max*3),3).setUsage(THREE.DynamicDrawUsage);
    this.aSR  = new THREE.InstancedBufferAttribute(new Float32Array(max*2),2).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max*4),4).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max*3),3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iSR', this.aSR); g.setAttribute('iCol', this.aCol);
    g.setAttribute('iVel', this.aVel);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      transparent:true, depthWrite:false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms:{ map:{value:tex}, uAmb: lit ? FXU.uAmb : {value:new THREE.Color(1,1,1)}, uStretch:{value: stretch?1:0} },
      vertexShader:`
        attribute vec3 iPos; attribute vec2 iSR; attribute vec4 iCol; attribute vec3 iVel;
        uniform float uStretch;
        varying vec2 vUv; varying vec4 vCol;
        void main(){
          vUv = uv; vCol = iCol;
          vec4 mv = modelViewMatrix*vec4(iPos,1.0);
          float c = cos(iSR.y), s = sin(iSR.y);
          vec2 p = position.xy;
          if(uStretch > 0.5){
            // искры вытягиваются вдоль скорости в экранной плоскости
            vec3 vv = (modelViewMatrix*vec4(iVel,0.0)).xyz;
            vec2 d = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(0.0,1.0);
            float L = 1.0 + length(vv.xy)*0.035;
            p = vec2(p.x, p.y*L);
            mv.xy += vec2(d.y*p.x + d.x*p.y, -d.x*p.x + d.y*p.y)*iSR.x;
          } else {
            mv.xy += vec2(c*p.x - s*p.y, s*p.x + c*p.y)*iSR.x;
          }
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader:`
        uniform sampler2D map; uniform vec3 uAmb;
        varying vec2 vUv; varying vec4 vCol;
        void main(){
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(t.rgb*vCol.rgb*uAmb, t.a*vCol.a);
          if(gl_FragColor.a < 0.004) discard;
        }`
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 6 : 5;
    this.mesh.userData.nomerge = true;
    this.P = [];   // данные симуляции
    scene.add(this.mesh);
  }
  /** o: {p, v, life, s0, s1, rot, spin, col:[r,g,b], a0, a1, drag, g, turb} */
  spawn(o){
    if(this.P.length >= this.max){ this.P.shift(); }
    this.P.push({ p:o.p.clone(), v:(o.v||new THREE.Vector3()).clone(), t:0, life:o.life||1,
      s0:o.s0??0.3, s1:o.s1??o.s0??0.3, rot:o.rot??Math.random()*6.28, spin:o.spin??0,
      col:o.col||[1,1,1], a0:o.a0??1, a1:o.a1??0, drag:o.drag??0.5, g:o.g??0, turb:o.turb??0,
      fadeIn:o.fadeIn??0.05, seed:Math.random()*100 });
  }
  update(dt, time){
    const P = this.P;
    for(let i=P.length-1;i>=0;i--){
      const q = P[i]; q.t += dt;
      if(q.t >= q.life){ P[i] = P[P.length-1]; P.pop(); continue; }
      q.v.y += q.g*dt;
      if(q.turb){ q.v.x += Math.sin(time*3.1+q.seed)*q.turb*dt; q.v.z += Math.cos(time*2.7+q.seed*1.3)*q.turb*dt; }
      const dr = Math.max(0, 1 - q.drag*dt);
      q.v.multiplyScalar(dr);
      q.p.addScaledVector(q.v, dt);
      if(q.floor !== undefined && q.p.y < q.floor){ q.p.y = q.floor; q.v.y *= -0.3; q.v.x*=0.5; q.v.z*=0.5; }
      q.rot += q.spin*dt;
    }
    const n = Math.min(P.length, this.max);
    const pa = this.aPos.array, sr = this.aSR.array, ca = this.aCol.array, va = this.aVel.array;
    for(let i=0;i<n;i++){
      const q = P[i], k = q.t/q.life;
      pa[i*3]=q.p.x; pa[i*3+1]=q.p.y; pa[i*3+2]=q.p.z;
      va[i*3]=q.v.x; va[i*3+1]=q.v.y; va[i*3+2]=q.v.z;
      sr[i*2] = lerp(q.s0, q.s1, Math.sqrt(k)); sr[i*2+1] = q.rot;
      const fin = q.fadeIn > 0 ? clamp(q.t/q.fadeIn, 0, 1) : 1;
      ca[i*4]=q.col[0]; ca[i*4+1]=q.col[1]; ca[i*4+2]=q.col[2]; ca[i*4+3]=lerp(q.a0, q.a1, k)*fin;
    }
    this.mesh.geometry.instanceCount = n;
    this.aPos.needsUpdate = this.aSR.needsUpdate = this.aCol.needsUpdate = this.aVel.needsUpdate = true;
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, n*3);
    this.aSR.clearUpdateRanges();  this.aSR.addUpdateRange(0, n*2);
    this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, n*4);
    this.aVel.clearUpdateRanges(); this.aVel.addUpdateRange(0, n*3);
  }
}

/* ============================================================================
   ЩЕПА, КРОШКА, ОСКОЛКИ — мелочь без физики тел: баллистика + отскок от пола
============================================================================ */
export class Chips {
  constructor(geo, mat, max=400){
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    this.mesh.userData.nomerge = true;
    this.max = max; this.P = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3();
    scene.add(this.mesh);
  }
  spawn(p, v, scale, floor=0, life=6){
    if(this.P.length >= this.max) this.P.shift();
    this.P.push({p:p.clone(), v:v.clone(), r:new THREE.Vector3(Math.random()*6,Math.random()*6,Math.random()*6),
      w:new THREE.Vector3(rnd(-18,18),rnd(-18,18),rnd(-18,18)), s:scale.clone ? scale.clone() : new THREE.Vector3(scale,scale,scale),
      floor, t:0, life, rest:false});
  }
  update(dt){
    const P = this.P;
    for(let i=P.length-1;i>=0;i--){
      const c = P[i]; c.t += dt;
      if(c.t > c.life){ P.splice(i,1); continue; }
      if(c.rest) continue;
      c.v.y -= 9.81*dt; c.p.addScaledVector(c.v, dt);
      c.r.addScaledVector(c.w, dt);
      if(c.p.y < c.floor + 0.004){
        c.p.y = c.floor + 0.004;
        if(Math.abs(c.v.y) > 0.8){ c.v.y *= -0.32; c.v.x *= 0.55; c.v.z *= 0.55; c.w.multiplyScalar(0.5); }
        else { c.rest = true; c.r.x = Math.round(c.r.x/Math.PI)*Math.PI; c.r.z = Math.round(c.r.z/Math.PI)*Math.PI; }
      }
    }
    const n = Math.min(P.length, this.max);
    for(let i=0;i<n;i++){
      const c = P[i];
      const sc = c.t > c.life-0.6 ? Math.max(0.01,(c.life-c.t)/0.6) : 1;
      this._e.set(c.r.x, c.r.y, c.r.z); this._q.setFromEuler(this._e);
      this._s.copy(c.s).multiplyScalar(sc);
      this._m.compose(c.p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ============================================================================
   ДЕКАЛИ: пулевые отверстия, гарь. Инстансы с офсетом ячейки атласа.
============================================================================ */
export class Decals {
  constructor(max=3000){
    this.max = max;
    const g = new THREE.PlaneGeometry(1,1);
    this.uvo = new THREE.InstancedBufferAttribute(new Float32Array(max*2), 2);
    g.setAttribute('iUvOff', this.uvo);
    const mat = M.decal.clone();
    mat.onBeforeCompile = sh=>{
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 iUvOff;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vMapUv = vec2(iUvOff.x + uv.x*0.25, iUvOff.y + uv.y*0.5);');
    };
    this.mesh = new THREE.InstancedMesh(g, mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2; this.mesh.userData.nomerge = true;
    this.keys = new Array(max); this.head = 0; this.used = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    this._z = new THREE.Vector3(0,0,1); this._zero = new THREE.Matrix4().makeScale(0,0,0);
    scene.add(this.mesh);
  }
  /** cell: 0..7 в атласе, n — нормаль поверхности, key — владелец (для удаления). */
  add(p, n, size, cell, key=null, rot=Math.random()*6.28){
    const i = this.head; this.head = (this.head+1) % this.max;
    this.used = Math.min(this.used+1, this.max);
    this._q.setFromUnitVectors(this._z, n);
    this._q.multiply(new THREE.Quaternion().setFromAxisAngle(this._z, rot));
    this._s.set(size, size, 1);
    this._m.compose(p.clone().addScaledVector(n, 0.003), this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
    this.uvo.setXY(i, (cell%4)*0.25, 0.5 - Math.floor(cell/4)*0.5);
    this.uvo.needsUpdate = true;
    this.keys[i] = key;
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    return i;
  }
  removeKey(key){
    let any = false;
    for(let i=0;i<this.used;i++) if(this.keys[i] === key){ this.mesh.setMatrixAt(i, this._zero); this.keys[i] = null; any = true; }
    if(any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ============================================================================
   ВСПЫШКИ: пул точечных источников с затуханием (выстрел, взрыв).
============================================================================ */
export class Flashes {
  constructor(n=4){
    this.L = [];
    for(let i=0;i<n;i++){ const l = new THREE.PointLight(0xffc27a, 0, 12, 2); l.position.set(0,-50,0); scene.add(l); this.L.push({l, t:1, dur:1, peak:0}); }
  }
  fire(p, color, peak, dist, dur){
    const f = this.L.reduce((a,b)=> (a.t/a.dur > b.t/b.dur ? a : b));
    f.l.position.copy(p); f.l.color.set(color); f.l.distance = dist; f.peak = peak; f.dur = dur; f.t = 0;
  }
  update(dt){
    for(const f of this.L){
      f.t += dt; const k = clamp(1 - f.t/f.dur, 0, 1);
      f.l.intensity = f.peak * k*k;
      if(k <= 0) f.l.position.y = -50;
    }
  }
}

/* ============================================================================
   ЗВУК: процедурный синтез + свёртка с синтетическим откликом ангара (2.8 с).
============================================================================ */
export const SND = {
  ctx:null, master:null, wet:null, noise:null, ok:false,
  fireGain:null, windGain:null, _pos:new THREE.Vector3(), _fwd:new THREE.Vector3(), _up:new THREE.Vector3(),
  init(){
    if(this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext; if(!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    // фильтр контузии: после близкого взрыва мир глохнет
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000;
    this.master.connect(this.lp); this.lp.connect(comp); comp.connect(ctx.destination);
    // реверберация: экспоненциально затухающий шум — огромный пустой ангар
    const len = ctx.sampleRate*2.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for(let ch=0; ch<2; ch++){ const d = ir.getChannelData(ch);
      for(let i=0;i<len;i++){ const t = i/ctx.sampleRate; d[i] = (Math.random()*2-1)*Math.pow(1-i/len, 2.2)*Math.exp(-t*1.1)*(t<0.012?t/0.012:1); } }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.42;
    this.wet.connect(conv); conv.connect(this.master);
    const nb = ctx.createBuffer(1, ctx.sampleRate*2, ctx.sampleRate), nd = nb.getChannelData(0);
    let b0=0,b1=0,b2=0;
    for(let i=0;i<nd.length;i++){ const w = Math.random()*2-1; nd[i] = w; }
    this.noise = nb;
    // розовый шум для ветра и огня
    const pb = ctx.createBuffer(1, ctx.sampleRate*4, ctx.sampleRate), pd = pb.getChannelData(0);
    for(let i=0;i<pd.length;i++){ const w=Math.random()*2-1; b0=0.99765*b0+w*0.0990460; b1=0.96300*b1+w*0.2965164; b2=0.57000*b2+w*1.0526913; pd[i]=(b0+b1+b2+w*0.1848)*0.18; }
    this.pink = pb;
    this.ok = true;
    this._ambience();
  },
  resume(){ if(this.ctx && this.ctx.state !== 'running') this.ctx.resume(); },
  _src(buf, loop=false){ const s = this.ctx.createBufferSource(); s.buffer = buf || this.noise; s.loop = loop; return s; },
  /** Цепочка выхода: панорама в 3D + отправка в ревербератор. */
  _out(pos, wet=0.5, ref=3){
    const ctx = this.ctx, g = ctx.createGain();
    if(pos){
      const p = ctx.createPanner();
      p.panningModel = Q.lights >= 6 ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse';
      p.refDistance = ref; p.rolloffFactor = 1.1; p.maxDistance = 200;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p); p.connect(this.master);
      const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.wet);
    } else { g.connect(this.master); const w = ctx.createGain(); w.gain.value = wet*0.6; g.connect(w); w.connect(this.wet); }
    return g;
  },
  _delay(pos){ if(!pos) return 0; return camera.position.distanceTo(pos)/343; },
  listener(){
    if(!this.ok) return;
    const L = this.ctx.listener, p = camera.position;
    camera.getWorldDirection(this._fwd); this._up.set(0,1,0).applyQuaternion(camera.quaternion);
    if(L.positionX){ L.positionX.value=p.x; L.positionY.value=p.y; L.positionZ.value=p.z;
      L.forwardX.value=this._fwd.x; L.forwardY.value=this._fwd.y; L.forwardZ.value=this._fwd.z;
      L.upX.value=this._up.x; L.upY.value=this._up.y; L.upZ.value=this._up.z; }
    else { L.setPosition(p.x,p.y,p.z); L.setOrientation(this._fwd.x,this._fwd.y,this._fwd.z,this._up.x,this._up.y,this._up.z); }
  },
  _burst(out, t, dur, type, f0, f1, q, gain, attack=0.002){
    const ctx = this.ctx, s = this._src(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = type; f.frequency.setValueAtTime(f0, t); if(f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20,f1), t+dur);
    f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t+attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random()*1.5); s.stop(t+dur+0.05);
  },
  _tone(out, t, dur, f0, f1, gain, type='sine'){
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(10,f1), t+dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t+0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t+dur+0.05);
  },
  shot(pos, own=false){
    if(!this.ok) return; const t = this.ctx.currentTime + (own?0:this._delay(pos));
    const out = this._out(own?null:pos, 0.75, 6);
    this._burst(out, t, 0.035, 'highpass', 2400, 1800, 0.7, own?0.9:0.7);
    this._burst(out, t, 0.22, 'lowpass', 2200, 300, 0.8, own?0.75:0.6);
    this._tone(out, t, 0.16, 140, 42, own?0.8:0.5);
    // механика затвора
    if(own){ this._burst(out, t+0.045, 0.02, 'bandpass', 3800, 3800, 6, 0.08); }
  },
  explosion(pos, big=1){
    if(!this.ok) return; const t = this.ctx.currentTime + this._delay(pos);
    const out = this._out(pos, 0.9, 10*big);
    this._burst(out, t, 1.8*big, 'lowpass', 3200, 120, 0.7, 1.0, 0.004);
    this._burst(out, t, 0.08, 'highpass', 1500, 800, 0.5, 0.8);
    this._tone(out, t, 1.1*big, 70, 22, 1.0);
    this._tone(out, t+0.02, 0.5, 45, 20, 0.7, 'triangle');
    for(let i=0;i<10;i++) this._burst(out, t+0.25+Math.random()*1.3, 0.05, 'bandpass', rnd(900,3000), rnd(500,1500), 3, rnd(0.03,0.12));
  },
  glass(pos, n=12){
    if(!this.ok) return; const t = this.ctx.currentTime + this._delay(pos);
    const out = this._out(pos, 0.55, 3);
    this._burst(out, t, 0.12, 'highpass', 3000, 2000, 0.5, 0.5);
    for(let i=0;i<n;i++){ const tt = t + Math.pow(Math.random(),1.6)*0.9;
      this._burst(out, tt, rnd(0.04,0.18), 'bandpass', rnd(3500,9000), rnd(3000,8000), rnd(8,20), rnd(0.05,0.25)); }
  },
  wood(pos, k=1){
    if(!this.ok) return; const t = this.ctx.currentTime + this._delay(pos);
    const out = this._out(pos, 0.45, 2.5);
    const n = 2 + Math.round(k*4);
    for(let i=0;i<n;i++) this._burst(out, t+i*rnd(0.008,0.03), rnd(0.02,0.06), 'bandpass', rnd(700,2400), rnd(500,1500), 2.5, rnd(0.15,0.45)*Math.min(1,k));
    this._tone(out, t, 0.12, rnd(170,240), 90, 0.35*Math.min(1,k));
  },
  hit(pos, surf){
    if(!this.ok) return; const t = this.ctx.currentTime + this._delay(pos);
    const out = this._out(pos, 0.4, 2);
    if(surf==='metal'){ for(const f of [rnd(900,1300), rnd(1800,2600), rnd(3200,4200)]) this._tone(out, t, rnd(0.2,0.45), f, f*0.98, 0.08);
      this._burst(out, t, 0.03, 'highpass', 3000, 2500, 1, 0.3); }
    else if(surf==='wood'){ this._burst(out, t, 0.05, 'bandpass', 1400, 700, 2, 0.4); this._tone(out, t, 0.08, 260, 120, 0.2); }
    else if(surf==='glass'){ this.glass(pos, 3); }
    else if(surf==='sand'){ this._burst(out, t, 0.08, 'lowpass', 900, 300, 0.5, 0.35); }
    else { this._burst(out, t, 0.05, 'bandpass', 2200, 1200, 1.2, 0.4); this._burst(out, t, 0.12, 'lowpass', 700, 200, 0.5, 0.2); }
  },
  thud(pos, k, surf){
    if(!this.ok) return; const t = this.ctx.currentTime;
    const out = this._out(pos, 0.3, 1.5), g = clamp(k*0.25, 0.02, 0.5);
    if(surf==='glass') { this._burst(out, t, 0.08, 'bandpass', rnd(4000,7000), 5000, 10, g*0.6); return; }
    if(surf==='metal') { this._tone(out, t, 0.25, rnd(500,900), 480, g*0.4); }
    this._burst(out, t, 0.07, 'lowpass', surf==='wood'?900:600, 150, 0.7, g);
  },
  step(surf, k=1){
    if(!this.ok) return; const t = this.ctx.currentTime, out = this._out(null, 0.25);
    if(surf==='metal'){ this._tone(out, t, 0.12, rnd(700,1000), 600, 0.05*k); this._burst(out, t, 0.05, 'bandpass', 1800, 900, 2, 0.08*k); }
    else if(surf==='wood'){ this._burst(out, t, 0.07, 'lowpass', 700, 180, 1.2, 0.2*k); this._tone(out, t, 0.06, 150, 90, 0.06*k); }
    else { this._burst(out, t, 0.05, 'bandpass', 1200, 500, 0.9, 0.14*k); }
  },
  bounce(pos){ if(!this.ok) return; const t=this.ctx.currentTime, out=this._out(pos,0.3,1.5); this._tone(out,t,0.1,rnd(1100,1500),900,0.12); },
  click(){ if(!this.ok) return; const t=this.ctx.currentTime, out=this._out(null,0.1); this._burst(out,t,0.03,'bandpass',2500,2500,5,0.25); this._burst(out,t+0.12,0.03,'bandpass',1800,1800,5,0.25); },
  /** Огонь: непрерывный рокот + случайные щелчки, громкость по ближайшему пламени. */
  fire(level, pos){
    if(!this.ok) return;
    if(!this.fireGain){
      const s = this._src(this.pink, true), f = this.ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value = 900;
      this.fireGain = this.ctx.createGain(); this.fireGain.gain.value = 0;
      s.connect(f); f.connect(this.fireGain); this.fireGain.connect(this.master);
      const w = this.ctx.createGain(); w.gain.value = 0.3; this.fireGain.connect(w); w.connect(this.wet); s.start();
    }
    this.fireGain.gain.setTargetAtTime(clamp(level,0,1)*0.55, this.ctx.currentTime, 0.3);
    if(level > 0.03 && Math.random() < level*0.5){
      const out = this._out(pos, 0.2, 2);
      this._burst(out, this.ctx.currentTime, rnd(0.01,0.04), 'bandpass', rnd(1500,5000), rnd(1000,3000), 2, rnd(0.05,0.25)*level);
    }
  },
  _ambience(){
    // ветер гуляет по кровле: полосовой розовый шум с медленной модуляцией
    const ctx = this.ctx, s = this._src(this.pink, true), f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 380; f.Q.value = 0.8;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.18;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 160;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    s.connect(f); f.connect(this.windGain); this.windGain.connect(this.master);
    const w = ctx.createGain(); w.gain.value = 0.5; this.windGain.connect(w); w.connect(this.wet);
    s.start();
    this._nextCreak = ctx.currentTime + 6;
  },
  ambienceTick(wind){
    if(!this.ok) return;
    const ctx = this.ctx;
    this.windGain.gain.setTargetAtTime(0.08 + clamp(wind/12,0,1)*0.22, ctx.currentTime, 0.8);
    if(ctx.currentTime > this._nextCreak){
      this._nextCreak = ctx.currentTime + rnd(7, 22);
      // скрип металла кровли: узкая полоса с медленным глиссандо
      const pos = new THREE.Vector3(rnd(-35,35), 10, rnd(-25,25));
      const out = this._out(pos, 0.9, 12), t = ctx.currentTime;
      this._burst(out, t, rnd(0.8,1.8), 'bandpass', rnd(260,420), rnd(140,220), 35, rnd(0.25,0.5), 0.3);
      if(Math.random() < 0.5) this._burst(out, t+0.1, 0.9, 'bandpass', rnd(900,1300), rnd(700,900), 40, 0.12, 0.2);
    }
  }
};

/* ============================================================================
   ЭКЗЕМПЛЯРЫ СИСТЕМ
============================================================================ */
export const FXS = {};
export function initFX(){
  const k = Q.dust >= 4000 ? 1 : (Q.dust >= 2000 ? 0.7 : 0.45);
  FXS.flame = new Particles({tex:FX.flame, max:Math.round(900*k), additive:true});
  FXS.smoke = new Particles({tex:FX.smoke, max:Math.round(1400*k), lit:true});
  FXS.dust  = new Particles({tex:FX.smoke, max:Math.round(900*k), lit:true});
  FXS.spark = new Particles({tex:FX.glow,  max:600, additive:true, stretch:true});
  FXS.ember = new Particles({tex:FX.glow,  max:500, additive:true});
  FXS.flash = new Particles({tex:FX.glow,  max:180, additive:true});
  FXS.fireball = new Particles({tex:FX.flame, max:120, additive:true});
  const box = new THREE.BoxGeometry(1,1,1);
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-.5,-.4,0, .5,-.3,0, .05,.5,0]),3));
  tri.computeVertexNormals();
  FXS.splinters = new Chips(box, M.wood, 700);
  FXS.concChips = new Chips(new THREE.DodecahedronGeometry(0.5,0), M.conc, 500);
  FXS.glassChips = new Chips(tri, M.glass, 500);
  FXS.decals = new Decals(Q.dust >= 4000 ? 4000 : 2500);
  FXS.flashes = new Flashes(4);
  return FXS;
}
export function updateFX(dt, t){
  for(const k of ['flame','smoke','dust','spark','ember','flash','fireball']) FXS[k].update(dt, t);
  FXS.splinters.update(dt); FXS.concChips.update(dt); FXS.glassChips.update(dt);
  FXS.flashes.update(dt);
}
