// Процедурные текстуры: albedo + карта высот → normal / roughness / AO.
import { THREE, clamp, lerp, srnd, sr, si, spick, TS, Q, renderer, TEXK } from './engine.js';
/* ============================================================================
   ПРОЦЕДУРНЫЕ ТЕКСТУРЫ: albedo + карта высот → normal + roughness
============================================================================ */
function cv(w,h){ const c=document.createElement('canvas'); c.width=w; c.height=h; return [c, c.getContext('2d',{willReadFrequently:true})]; }

/** Рисует fn 9 раз со сдвигами — результат бесшовный по обеим осям. */
function wrapDraw(x, size, fn){
  for(let ox=-1; ox<=1; ox++) for(let oy=-1; oy<=1; oy++){
    x.save(); x.translate(ox*size, oy*size); fn(); x.restore();
  }
}
function grain(x, w, h, amt){
  const img = x.getImageData(0,0,w,h), d = img.data;
  for(let i=0;i<d.length;i+=4){
    const n = (Math.random()-0.5)*amt*255;
    d[i]=clamp(d[i]+n,0,255); d[i+1]=clamp(d[i+1]+n,0,255); d[i+2]=clamp(d[i+2]+n,0,255);
  }
  x.putImageData(img,0,0);
}
/** Карта высот → AO: усреднённая окклюзия по окрестности, углубления темнее. */
function heightToAO(hc, power=1.0){
  const sz = hc.width, hx = hc.getContext('2d');
  const src = hx.getImageData(0,0,sz,sz).data;
  const [ac, ax] = cv(sz,sz);
  const out = ax.createImageData(sz,sz), o = out.data;
  const H = (x,y)=> src[(((y+sz)%sz)*sz + ((x+sz)%sz))*4] / 255;
  const R = 4;
  for(let y=0;y<sz;y++) for(let x=0;x<sz;x++){
    const h = H(x,y);
    let higher = 0, n = 0;
    for(let dy=-R; dy<=R; dy+=2) for(let dx=-R; dx<=R; dx+=2){
      if(!dx && !dy) continue;
      higher += Math.max(0, H(x+dx,y+dy) - h); n++;
    }
    const occ = clamp(1 - (higher/n)*5.0*power, 0, 1);
    const v = Math.round(clamp(0.35 + occ*0.65, 0, 1)*255);
    const i = (y*sz+x)*4;
    o[i]=o[i+1]=o[i+2]=v; o[i+3]=255;
  }
  ax.putImageData(out,0,0);
  return ac;
}
/** Карта высот (градации серого canvas) → нормаль-карта. */
function heightToNormal(hc, strength=2.0){
  const s = hc.width, hx = hc.getContext('2d');
  const src = hx.getImageData(0,0,s,s).data;
  const [nc, nx] = cv(s,s);
  const out = nx.createImageData(s,s), o = out.data;
  const H = (x,y)=> src[(((y+s)%s)*s + ((x+s)%s))*4] / 255;
  for(let y=0;y<s;y++) for(let x=0;x<s;x++){
    const dx = (H(x+1,y) - H(x-1,y)) * strength;
    const dy = (H(x,y+1) - H(x,y-1)) * strength;
    let nxv = -dx, nyv = -dy, nzv = 1;
    const l = Math.hypot(nxv,nyv,nzv);
    const i = (y*s+x)*4;
    o[i]   = (nxv/l*0.5+0.5)*255;
    o[i+1] = (nyv/l*0.5+0.5)*255;
    o[i+2] = (nzv/l*0.5+0.5)*255;
    o[i+3] = 255;
  }
  nx.putImageData(out,0,0);
  return nc;
}
// Анизотропия ограничена профилем: на слабой видеокарте она заметно
// дороже, чем выигрыш в резкости косых поверхностей.
const MAXA = ()=> Math.min(renderer.capabilities.getMaxAnisotropy(), Q.anisotropy);
function T(canvas, rx=1, ry=1, srgb=true){
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx,ry);
  t.anisotropy = MAXA();
  if(srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- OSB: стружка, уложенная слоями ---------- */
function osbMaps(size=1024, tint=1){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  // Текстура покрывает ~1.22 м (ширина листа) → 1 px ≈ 1.2 мм.
  // Реальная щепа ОСП: длина 50-150 мм, ширина 10-25 мм → 40-125 px x 8-20 px.
  x.fillStyle = `rgb(${212*tint|0},${183*tint|0},${133*tint|0})`; x.fillRect(0,0,size,size);
  hx.fillStyle = '#6a6a6a'; hx.fillRect(0,0,size,size);
  rx.fillStyle = '#b8b8b8'; rx.fillRect(0,0,size,size);

  const layers = [
    {n:1400, a:()=>sr(0,6.283),                    w:[44,120], hgt:[9,19],  op:[.55,.85], hz:[0.30,0.48]},
    {n:1100, a:()=>sr(0,6.283),                    w:[50,132], hgt:[10,21], op:[.5,.82],  hz:[0.46,0.64]},
    // верхний слой ориентирован вдоль листа, но с широким разбросом ±35°
    {n:1500, a:()=>sr(-0.62,0.62) + (srnd()<0.18 ? 1.57 : 0), w:[56,148], hgt:[10,23], op:[.55,.88], hz:[0.62,0.84]}
  ];
  for(const L of layers){
    for(let i=0;i<L.n*TEXK;i++){
      const w = sr(L.w[0],L.w[1]), hh = sr(L.hgt[0],L.hgt[1]), a = L.a();
      const px = srnd()*size, py = srnd()*size;
      // Щепа берётся из разных частей ствола: светлая заболонь и тёмное ядро.
      const lum = sr(0.88, 1.08);
      const warm = sr(0.90, 1.04);
      const r = clamp(230*lum*tint, 0, 255)|0,
            g = clamp(198*lum*tint*warm, 0, 255)|0,
            b = clamp(144*lum*tint*warm*sr(0.95,1.04), 0, 255)|0;
      const op = sr(L.op[0], L.op[1]);
      const hv = Math.round(sr(L.hz[0], L.hz[1])*255);
      const rr = Math.min(hh*0.42, 5);
      const rv = si(140, 210);

      wrapDraw(x, size, ()=>{
        x.save(); x.translate(px,py); x.rotate(a);
        x.fillStyle = `rgba(${r},${g},${b},${op})`;
        x.beginPath(); x.roundRect(-w/2,-hh/2,w,hh, rr); x.fill();
        // продольные волокна древесины вдоль щепы
        x.strokeStyle = `rgba(${clamp(r*0.80,0,255)|0},${clamp(g*0.76,0,255)|0},${clamp(b*0.68,0,255)|0},.14)`;
        x.lineWidth = 0.7;
        const fib = 2 + Math.floor(hh/6);
        for(let k=1;k<fib;k++){
          const yy = -hh/2 + hh*k/fib;
          x.beginPath(); x.moveTo(-w/2+rr, yy); x.lineTo(w/2-rr, yy); x.stroke();
        }
        // тень по контуру: щепа лежит слоями, между ними видны зазоры
        x.strokeStyle = `rgba(${clamp(r*0.64,0,255)|0},${clamp(g*0.60,0,255)|0},${clamp(b*0.54,0,255)|0},.20)`;
        x.lineWidth = 0.8;
        x.beginPath(); x.roundRect(-w/2,-hh/2,w,hh, rr); x.stroke();
        x.restore();
      });
      wrapDraw(hx, size, ()=>{
        hx.save(); hx.translate(px,py); hx.rotate(a);
        hx.fillStyle = `rgba(${hv},${hv},${hv},${op})`;
        hx.beginPath(); hx.roundRect(-w/2,-hh/2,w,hh, rr); hx.fill();
        hx.strokeStyle = 'rgba(32,32,32,.55)'; hx.lineWidth = 1.3;
        hx.beginPath(); hx.roundRect(-w/2,-hh/2,w,hh, rr); hx.stroke();
        hx.restore();
      });
      wrapDraw(rx, size, ()=>{
        rx.save(); rx.translate(px,py); rx.rotate(a);
        rx.fillStyle = `rgba(${rv},${rv},${rv},${op*0.8})`;
        rx.beginPath(); rx.roundRect(-w/2,-hh/2,w,hh, rr); rx.fill();
        rx.strokeStyle = 'rgba(248,248,248,.55)'; rx.lineWidth = 1.4;
        rx.beginPath(); rx.roundRect(-w/2,-hh/2,w,hh, rr); rx.stroke();
        rx.restore();
      });
    }
  }
  // смоляные глянцевые пятна
  for(let i=0;i<110;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(20,120), al=sr(.05,.17);
    wrapDraw(x, size, ()=>{
      const g = x.createRadialGradient(px,py,2,px,py,r);
      g.addColorStop(0,`rgba(146,116,72,${al*0.8})`); g.addColorStop(1,'rgba(146,116,72,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
    wrapDraw(rx, size, ()=>{
      const g = rx.createRadialGradient(px,py,2,px,py,r);
      g.addColorStop(0,`rgba(84,84,84,${al*2.8})`); g.addColorStop(1,'rgba(84,84,84,0)');
      rx.fillStyle=g; rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill();
    });
  }
  // светлая древесная пыль в углублениях
  for(let i=0;i<150;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(10,58), v=si(186,214);
    wrapDraw(x, size, ()=>{
      const g = x.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,`rgba(${v+22},${v+8},${v-18},${sr(.06,.15)})`); g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
  }
  grain(x,size,size,0.028);
  return {albedo:c, height:h, rough:rg};
}

/* ---------- Бетонный пол ---------- */
function concreteMaps(size=768){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  // Промышленный бетон — нейтрально-серый с лёгкой тёплой примесью, не бежевый.
  x.fillStyle='#86837d'; x.fillRect(0,0,size,size);
  hx.fillStyle='#aaaaaa'; hx.fillRect(0,0,size,size);
  rx.fillStyle='#e0e0e0'; rx.fillRect(0,0,size,size);
  // облачные пятна затирки
  for(let i=0;i<340;i++){
    const v = si(98,164);
    const px=srnd()*size, py=srnd()*size, r=sr(10,70), al=sr(.04,.16);
    wrapDraw(x, size, ()=>{ x.fillStyle=`rgba(${v},${v-2},${v-7},${al})`;
      x.beginPath(); x.arc(px,py,r,0,7); x.fill(); });
  }
  // мелкие каверны и щебень в высоте
  for(let i=0;i<2400;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(0.7,3.4);
    const dark = srnd()<0.5;
    const hv = dark ? si(120,150) : si(170,205);
    wrapDraw(hx, size, ()=>{ hx.fillStyle=`rgba(${hv},${hv},${hv},.6)`;
      hx.beginPath(); hx.arc(px,py,r,0,7); hx.fill(); });
    if(srnd()<0.35){
      const v = dark ? si(92,126) : si(146,176);
      wrapDraw(x, size, ()=>{ x.fillStyle=`rgba(${v},${v-1},${v-4},.4)`;
        x.beginPath(); x.arc(px,py,r,0,7); x.fill(); });
    }
  }
  // масляные и грязевые разводы: тёмные и глянцевые
  for(let i=0;i<26;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(40,150), v=si(38,68), al=sr(.12,.30);
    wrapDraw(x, size, ()=>{
      const g=x.createRadialGradient(px,py,2,px,py,r);
      g.addColorStop(0,`rgba(${v},${v-1},${v+2},${al})`); g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
    wrapDraw(rx, size, ()=>{
      const g=rx.createRadialGradient(px,py,2,px,py,r);
      g.addColorStop(0,`rgba(74,74,74,${al*2.2})`); g.addColorStop(1,'rgba(74,74,74,0)');
      rx.fillStyle=g; rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill();
    });
  }
  // затёртые до глянца проезды и пятна цементного молока
  for(let i=0;i<18;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(60,180);
    wrapDraw(rx, size, ()=>{
      const g=rx.createRadialGradient(px,py,2,px,py,r);
      g.addColorStop(0,`rgba(168,168,168,${sr(.15,.4)})`); g.addColorStop(1,'rgba(168,168,168,0)');
      rx.fillStyle=g; rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill();
    });
    wrapDraw(x, size, ()=>{
      const v=si(150,178);
      const g=x.createRadialGradient(px,py,2,px,py,r);
      g.addColorStop(0,`rgba(${v},${v},${v-3},${sr(.04,.12)})`); g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
  }
  // трещины: ветвление с затуханием
  function crack(ctx, px,py,ang,len,w,col){
    ctx.strokeStyle=col; ctx.lineWidth=w; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(px,py);
    let cx=px, cy=py, a=ang;
    for(let j=0;j<len;j++){
      a += sr(-0.32,0.32); cx += Math.cos(a)*sr(5,13); cy += Math.sin(a)*sr(5,13);
      ctx.lineTo(cx,cy);
    }
    ctx.stroke();
    return [cx,cy,a];
  }
  for(let i=0;i<5;i++){
    const px=srnd()*size, py=srnd()*size, a=sr(0,6.28), w=sr(0.6,1.3);
    wrapDraw(x, size, ()=>{
      const [ex,ey,ea] = crack(x,px,py,a,9,w,'rgba(58,55,52,.34)');
      if(srnd()<0.6) crack(x,ex,ey,ea+sr(0.5,1.2),5,w*0.6,'rgba(58,55,52,.24)');
    });
    wrapDraw(hx, size, ()=>{
      const [ex,ey,ea] = crack(hx,px,py,a,9,w*1.3,'rgba(44,44,44,.7)');
      if(srnd()<0.6) crack(hx,ex,ey,ea+sr(0.5,1.2),5,w*0.8,'rgba(44,44,44,.5)');
    });
  }
  // Швы плит НЕ рисуем в текстуре: при тайлинге они дают регулярную решётку.
  // Вместо этого швы кладутся отдельной геометрией по границам плит пола.
  grain(x,size,size,0.035);
  return {albedo:c, height:h, rough:rg};
}

/* ---------- Пиломатериал каркаса ---------- */
function lumberMaps(size=512){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  // Сосновый брус: текстура кроется вдоль волокна, годовые слои идут полосами
  // разной плотности, между ними — тёмная поздняя древесина.
  x.fillStyle='#c9b48f'; x.fillRect(0,0,size,size);
  hx.fillStyle='#8c8c8c'; hx.fillRect(0,0,size,size);
  rx.fillStyle='#cacaca'; rx.fillRect(0,0,size,size);

  // годовые слои: пары «ранняя светлая / поздняя тёмная» древесина
  let y = 0;
  while(y < size){
    const early = sr(16, 44);         // светлая широкая зона
    const late  = sr(1.4, 3.4);       // тёмная узкая зона
    const wob   = sr(6, 16);          // изгиб слоя по длине
    const phase = sr(0, 6.28);
    const lumE  = sr(0.94, 1.06);
    const lumL  = sr(0.76, 0.88);
    for(let px=0; px<size; px++){
      const off = Math.sin(px/size*Math.PI*2 + phase)*wob*0.35
                + Math.sin(px/size*Math.PI*6 + phase*2)*wob*0.12;
      // ранняя древесина
      const ye = y + off;
      x.fillStyle = `rgba(${clamp(214*lumE,0,255)|0},${clamp(189*lumE,0,255)|0},${clamp(146*lumE,0,255)|0},.85)`;
      x.fillRect(px, ye, 1, early);
      hx.fillStyle = `rgba(${clamp(176*lumE,0,255)|0},${clamp(176*lumE,0,255)|0},${clamp(176*lumE,0,255)|0},.8)`;
      hx.fillRect(px, ye, 1, early);
      rx.fillStyle = `rgba(${clamp(206*lumE,0,255)|0},${clamp(206*lumE,0,255)|0},${clamp(206*lumE,0,255)|0},.6)`;
      rx.fillRect(px, ye, 1, early);
      // поздняя древесина: темнее, плотнее, чуть ниже по высоте
      const yl = ye + early;
      x.fillStyle = `rgba(${clamp(168*lumL*1.15,0,255)|0},${clamp(134*lumL*1.15,0,255)|0},${clamp(92*lumL*1.15,0,255)|0},.8)`;
      x.fillRect(px, yl, 1, late);
      hx.fillStyle = `rgba(${clamp(96*lumL,0,255)|0},${clamp(96*lumL,0,255)|0},${clamp(96*lumL,0,255)|0},.85)`;
      hx.fillRect(px, yl, 1, late);
      rx.fillStyle = 'rgba(146,146,146,.55)';
      rx.fillRect(px, yl, 1, late);
    }
    y += early + late;
  }
  // тонкие волокна поверх слоёв — придают дереву «ворс»
  for(let i=0;i<size*1.1;i++){
    const yy = srnd()*size, len = sr(size*0.2, size), x0 = srnd()*size;
    const v = si(160, 215), a = sr(.03,.09);
    x.strokeStyle = `rgba(${v},${(v*0.86)|0},${(v*0.64)|0},${a})`;
    x.lineWidth = sr(0.5, 1.4);
    x.beginPath();
    x.moveTo(x0, yy);
    x.bezierCurveTo(x0+len*0.33, yy+sr(-2.5,2.5), x0+len*0.66, yy+sr(-2.5,2.5), x0+len, yy+sr(-3,3));
    x.stroke();
  }
  // сучки: тёмные овалы с расходящимися вокруг волокнами
  for(let i=0;i<5;i++){
    const px=srnd()*size, py=srnd()*size, rr=sr(6,15), ry=rr*sr(0.45,0.75);
    wrapDraw(x, size, ()=>{
      // волокна обтекают сучок
      x.strokeStyle='rgba(126,96,54,.28)'; x.lineWidth=1.1;
      for(let k=0;k<7;k++){
        const o = (k-3)*rr*0.5;
        x.beginPath();
        x.moveTo(px-rr*3.4, py+o);
        x.quadraticCurveTo(px, py+o*sr(1.5,2.4), px+rr*3.4, py+o);
        x.stroke();
      }
      const g=x.createRadialGradient(px,py,1,px,py,rr);
      g.addColorStop(0,'rgba(74,48,24,.95)'); g.addColorStop(.62,'rgba(104,70,36,.78)');
      g.addColorStop(1,'rgba(128,92,52,0)');
      x.fillStyle=g; x.beginPath(); x.ellipse(px,py,rr,ry,sr(0,3),0,7); x.fill();
    });
    wrapDraw(hx, size, ()=>{
      const g=hx.createRadialGradient(px,py,1,px,py,rr);
      g.addColorStop(0,'rgba(54,54,54,.9)'); g.addColorStop(1,'rgba(140,140,140,0)');
      hx.fillStyle=g; hx.beginPath(); hx.ellipse(px,py,rr,ry,0,0,7); hx.fill();
    });
    wrapDraw(rx, size, ()=>{
      const g=rx.createRadialGradient(px,py,1,px,py,rr);
      g.addColorStop(0,'rgba(108,108,108,.8)'); g.addColorStop(1,'rgba(108,108,108,0)');
      rx.fillStyle=g; rx.beginPath(); rx.ellipse(px,py,rr,ry,0,0,7); rx.fill();
    });
  }
  // следы пилы и заводская маркировка-штамп
  for(let i=0;i<8;i++){
    const yy=srnd()*size;
    x.strokeStyle=`rgba(${si(160,196)},${si(140,172)},${si(110,140)},.07)`;
    x.lineWidth=sr(1.5,4);
    x.beginPath(); x.moveTo(0,yy); x.lineTo(size,yy+sr(-3,3)); x.stroke();
  }
  // серые потёртости и грязь от рук/опалубки
  for(let i=0;i<70;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(10,54), v=si(120,168);
    wrapDraw(x, size, ()=>{
      const g=x.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,`rgba(${v},${v-6},${v-20},${sr(.05,.16)})`); g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
    wrapDraw(rx, size, ()=>{
      const g=rx.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,`rgba(${si(150,210)},${si(150,210)},${si(150,210)},${sr(.08,.26)})`);
      g.addColorStop(1,'rgba(0,0,0,0)');
      rx.fillStyle=g; rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill();
    });
  }
  grain(x,size,size,0.028);
  return {albedo:c, height:h, rough:rg};
}

/* ---------- Профлист (стены и кровля ангара) ---------- */
function corrugatedMaps(size=512, rust=0.5, base=[118,112,104], ribs=7){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  rx.fillStyle='#8a8a8a'; rx.fillRect(0,0,size,size);
  for(let i=0;i<size;i++){
    // Трапециевидный профиль: широкая полка, наклонная стенка, узкая канавка.
    const t = (i/size*ribs) % 1;
    let prof;                                   // 0 = дно канавки, 1 = верх полки
    if(t < 0.58)      prof = 1.0;                    // широкая верхняя полка
    else if(t < 0.70) prof = 1.0 - (t-0.58)/0.12;    // стенка вниз
    else if(t < 0.88) prof = 0.06;                   // узкое дно
    else              prof = (t-0.88)/0.12;          // стенка вверх
    // мягкий перепад: дно лишь притенено, а не чёрное
    const k = 0.80 + prof*0.30 + (prof>0.08&&prof<0.94 ? -0.06 : 0);
    x.fillStyle = `rgb(${clamp(base[0]*k,0,255)|0},${clamp(base[1]*k,0,255)|0},${clamp(base[2]*k,0,255)|0})`;
    x.fillRect(i,0,1,size);
    const hv = Math.round(60 + prof*175);
    hx.fillStyle = `rgb(${hv},${hv},${hv})`; hx.fillRect(i,0,1,size);
  }
  // поперечные стыки листов
  for(let k=0;k<2;k++){
    const y = size*(0.5*k + 0.25);
    x.fillStyle='rgba(72,66,60,.3)'; x.fillRect(0,y,size,2);
    hx.fillStyle='rgba(30,30,30,.8)'; hx.fillRect(0,y,size,3);
  }
  // саморезы
  for(let k=0;k<2;k++){
    const y = size*(0.5*k + 0.25) + 1;
    for(let i=0;i<ribs;i++){
      const px = (i+0.5)*size/ribs;
      x.fillStyle='rgba(86,78,70,.5)'; x.beginPath(); x.arc(px,y,2.2,0,7); x.fill();
      hx.fillStyle='rgba(230,230,230,.9)'; hx.beginPath(); hx.arc(px,y,2.4,0,7); hx.fill();
    }
  }
  for(let i=0;i<rust*240;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(3,30);
    const col = `rgba(${si(104,152)},${si(68,96)},${si(44,62)},${sr(.08,.34)})`;
    wrapDraw(x, size, ()=>{
      const g=x.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,col); g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
    // ржавчина матовая: в roughness почти белая
    wrapDraw(rx, size, ()=>{
      const g=rx.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,`rgba(240,240,240,${sr(.2,.6)})`); g.addColorStop(1,'rgba(240,240,240,0)');
      rx.fillStyle=g; rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill();
    });
  }
  // вертикальные потёки
  for(let i=0;i<22;i++){
    const px=srnd()*size, w=sr(2,9), y0=srnd()*size;
    const g=x.createLinearGradient(px,y0,px,y0+size*0.5);
    g.addColorStop(0,`rgba(${si(88,126)},${si(58,80)},${si(38,52)},.2)`);
    g.addColorStop(1,'rgba(0,0,0,0)');
    x.fillStyle=g; x.fillRect(px,y0,w,size*0.5);
  }
  grain(x,size,size,0.028);
  return {albedo:c, height:h, rough:rg};
}

/* ---------- Ржавый крашеный металл (колонны, фермы) ---------- */
function steelMaps(size=512, baseCol=[64,60,58]){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  rx.fillStyle='#6e6e6e'; rx.fillRect(0,0,size,size);
  x.fillStyle=`rgb(${baseCol[0]},${baseCol[1]},${baseCol[2]})`; x.fillRect(0,0,size,size);
  hx.fillStyle='#b4b4b4'; hx.fillRect(0,0,size,size);
  // облезшая краска
  for(let i=0;i<420;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(3,26);
    const col=`rgba(${si(96,156)},${si(58,90)},${si(36,56)},${sr(.14,.58)})`;
    wrapDraw(x, size, ()=>{
      const g=x.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,col); g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
    wrapDraw(rx, size, ()=>{
      const g=rx.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,`rgba(235,235,235,${sr(.25,.7)})`); g.addColorStop(1,'rgba(235,235,235,0)');
      rx.fillStyle=g; rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill();
    });
    wrapDraw(hx, size, ()=>{
      const hv=si(130,190);
      hx.fillStyle=`rgba(${hv},${hv},${hv},.25)`;
      hx.beginPath(); hx.arc(px,py,r*0.6,0,7); hx.fill();
    });
  }
  // потёки ржавчины
  for(let i=0;i<26;i++){
    const px=srnd()*size, w=sr(1.5,7), y0=srnd()*size;
    const g=x.createLinearGradient(px,y0,px,y0+size*0.6);
    g.addColorStop(0,`rgba(${si(96,152)},${si(52,82)},${si(24,44)},.42)`);
    g.addColorStop(1,'rgba(0,0,0,0)');
    x.fillStyle=g; x.fillRect(px,y0,w,size*0.6);
  }
  grain(x,size,size,0.045);
  return {albedo:c, height:h, rough:rg};
}

/* ---------- Бетонная панель цоколя ---------- */
function panelMaps(size=768){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  x.fillStyle='#8a8884'; x.fillRect(0,0,size,size);
  hx.fillStyle='#b0b0b0'; hx.fillRect(0,0,size,size);
  rx.fillStyle='#dcdcdc'; rx.fillRect(0,0,size,size);
  for(let i=0;i<420;i++){
    const v=si(112,162), px=srnd()*size, py=srnd()*size, r=sr(6,40);
    wrapDraw(x, size, ()=>{ x.fillStyle=`rgba(${v},${v-2},${v-8},${sr(.04,.16)})`;
      x.beginPath(); x.arc(px,py,r,0,7); x.fill(); });
  }
  // поры и сколы
  for(let i=0;i<1500;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(0.6,2.6), hv=si(118,150);
    wrapDraw(hx, size, ()=>{ hx.fillStyle=`rgba(${hv},${hv},${hv},.5)`;
      hx.beginPath(); hx.arc(px,py,r,0,7); hx.fill(); });
  }
  // швы панелей
  const seam = (x0,y0,x1,y1)=>{
    x.strokeStyle='rgba(66,62,56,.55)'; x.lineWidth=4;
    x.beginPath(); x.moveTo(x0,y0); x.lineTo(x1,y1); x.stroke();
    hx.strokeStyle='rgba(48,48,48,.95)'; hx.lineWidth=6;
    hx.beginPath(); hx.moveTo(x0,y0); hx.lineTo(x1,y1); hx.stroke();
  };
  seam(0,0,size,0); seam(0,size-2,size,size-2);
  seam(0,size/2,size,size/2); seam(0,0,0,size); seam(size-2,0,size-2,size);
  // потёки от дождя сверху
  for(let i=0;i<26;i++){
    const px=srnd()*size, w=sr(4,26);
    const g=x.createLinearGradient(px,0,px,size);
    g.addColorStop(0,'rgba(58,52,44,.34)'); g.addColorStop(.6,'rgba(58,52,44,.08)'); g.addColorStop(1,'rgba(58,52,44,0)');
    x.fillStyle=g; x.fillRect(px,0,w,size);
  }
  // мох/грязь понизу
  const gm = x.createLinearGradient(0,size*0.72,0,size);
  gm.addColorStop(0,'rgba(48,50,40,0)'); gm.addColorStop(1,'rgba(48,50,40,.38)');
  x.fillStyle=gm; x.fillRect(0,size*0.72,size,size*0.28);
  // мокрые подтёки — глянцевее сухого бетона
  for(let i=0;i<20;i++){
    const px=srnd()*size, w=sr(6,30);
    const g=rx.createLinearGradient(px,0,px,size);
    g.addColorStop(0,`rgba(120,120,120,${sr(.2,.45)})`); g.addColorStop(1,'rgba(120,120,120,0)');
    rx.fillStyle=g; rx.fillRect(px,0,w,size);
  }
  grain(x,size,size,0.03);
  return {albedo:c, height:h, rough:rg};
}

/* ---------- Граффити: крупные росписи во всю стену, как в референсе ---------- */
function graffitiTex(kind, w=512, h=512){
  const [c,x] = cv(w,h);
  x.clearRect(0,0,w,h);
  x.lineCap='round'; x.lineJoin='round';
  // Выгоревшие, приглушённые пигменты: свежая яркая краска выглядит наклейкой.
  const pal = [
    ['#6e3630','#9a8244','#3b4152'], ['#33415c','#6b4560','#a8aaa8'],
    ['#3c3832','#8a5340','#a89a7c'], ['#47523c','#7a4038','#b0aa9a']
  ][kind % 4];
  const A = pal[0], B = pal[1], C = pal[2];

  if(kind % 4 === 0){
    // вертикальные фигуры-«тотемы», как на референсе с балконом
    const n = si(4,6);
    for(let i=0;i<n;i++){
      const cx = w*(i+0.5)/n, cw = w/n*0.72;
      x.fillStyle = i%2 ? A : C; x.globalAlpha = sr(.55,.85);
      x.beginPath();
      x.moveTo(cx, h*0.10);
      x.bezierCurveTo(cx+cw*0.5, h*0.28, cx+cw*0.32, h*0.62, cx+cw*0.16, h*0.92);
      x.lineTo(cx-cw*0.16, h*0.92);
      x.bezierCurveTo(cx-cw*0.32, h*0.62, cx-cw*0.5, h*0.28, cx, h*0.10);
      x.fill();
      x.globalAlpha = sr(.5,.8); x.fillStyle = B;
      x.beginPath(); x.arc(cx, h*0.20, cw*0.19, 0, 7); x.fill();
      x.strokeStyle = '#1a1a1c'; x.globalAlpha=.5; x.lineWidth = 3;
      x.beginPath(); x.moveTo(cx-cw*0.2, h*0.5); x.lineTo(cx+cw*0.2, h*0.55); x.stroke();
    }
  } else if(kind % 4 === 1){
    // объёмный бабл-тэг
    x.globalAlpha=.8;
    const txt = spick(['RAID','OSB','KILO','7-2','VOID']);
    x.font = `900 ${Math.round(h*0.34)}px "Arial Black",Impact,sans-serif`;
    x.textAlign='center'; x.textBaseline='middle';
    x.lineWidth = h*0.055; x.strokeStyle = C; x.strokeText(txt, w/2, h*0.46);
    x.fillStyle = A; x.fillText(txt, w/2, h*0.46);
    x.lineWidth = h*0.012; x.strokeStyle='#131316'; x.strokeText(txt, w/2, h*0.46);
    x.globalAlpha=.6; x.fillStyle=B;
    x.fillText(txt, w/2 + h*0.02, h*0.46 + h*0.022);
    x.globalAlpha=.75; x.fillStyle = A; x.fillText(txt, w/2, h*0.46);
    x.globalAlpha=.55; x.strokeStyle=B; x.lineWidth=h*0.02;
    x.beginPath(); x.moveTo(w*0.08,h*0.76); x.bezierCurveTo(w*0.35,h*0.66,w*0.65,h*0.92,w*0.93,h*0.72); x.stroke();
  } else if(kind % 4 === 2){
    // мурал: крупное лицо/маска абстракцией
    x.globalAlpha=.72; x.fillStyle=C;
    x.beginPath(); x.ellipse(w/2, h*0.5, w*0.31, h*0.38, 0, 0, 7); x.fill();
    x.globalAlpha=.85; x.fillStyle=A;
    x.beginPath(); x.ellipse(w*0.39, h*0.42, w*0.065, h*0.042, -0.25, 0, 7); x.fill();
    x.beginPath(); x.ellipse(w*0.61, h*0.42, w*0.065, h*0.042, 0.25, 0, 7); x.fill();
    x.strokeStyle=B; x.lineWidth=h*0.03; x.globalAlpha=.8;
    x.beginPath(); x.moveTo(w*0.40,h*0.66); x.quadraticCurveTo(w*0.5,h*0.74,w*0.60,h*0.66); x.stroke();
    x.lineWidth=h*0.016; x.strokeStyle='#17171a'; x.globalAlpha=.6;
    x.beginPath(); x.ellipse(w/2, h*0.5, w*0.31, h*0.38, 0, 0, 7); x.stroke();
  } else {
    // рваный «drip»-тэг с потёками
    x.globalAlpha=.8; x.strokeStyle=A; x.lineWidth=h*0.07;
    x.beginPath(); x.moveTo(w*0.1,h*0.62);
    for(let i=0;i<6;i++) x.quadraticCurveTo(w*(0.1+i*0.16), h*(i%2?0.24:0.82), w*(0.2+i*0.15), h*0.55);
    x.stroke();
    x.lineWidth=h*0.02; x.strokeStyle=C; x.globalAlpha=.7;
    x.beginPath(); x.moveTo(w*0.1,h*0.66);
    for(let i=0;i<6;i++) x.quadraticCurveTo(w*(0.1+i*0.16), h*(i%2?0.3:0.86), w*(0.2+i*0.15), h*0.6);
    x.stroke();
    for(let i=0;i<14;i++){    // потёки краски вниз
      const px = w*sr(0.12,0.9), py = h*sr(0.5,0.72), len = h*sr(0.05,0.26);
      x.globalAlpha=sr(.35,.7); x.strokeStyle=A; x.lineWidth=sr(3,9);
      x.beginPath(); x.moveTo(px,py); x.lineTo(px+sr(-4,4),py+len); x.stroke();
    }
  }
  // аэрозольная пыль по краям штрихов
  x.globalAlpha=1;
  const img = x.getImageData(0,0,w,h), d = img.data;
  for(let i=0;i<2600;i++){
    const px = Math.floor(srnd()*w), py = Math.floor(srnd()*h);
    const k = (py*w+px)*4;
    if(d[k+3] > 30) continue;
    // проверяем соседей: рисуем пыль только рядом с краской
    let near = false;
    for(let o=-6;o<=6 && !near;o+=3) for(let p=-6;p<=6 && !near;p+=3){
      const kk = (clamp(py+p,0,h-1)*w + clamp(px+o,0,w-1))*4;
      if(d[kk+3] > 90) near = true;
    }
    if(!near) continue;
    const col = [A,B,C][Math.floor(srnd()*3)];
    x.fillStyle = col; x.globalAlpha = sr(.05,.3);
    x.fillRect(px,py,sr(1,2.6),sr(1,2.6));
  }
  x.globalAlpha=1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAXA();
  return t;
}

/* ---------- Плакаты/наклейки на стенах ---------- */
function posterTex(kind){
  const [c,x] = cv(256,360);
  const bg = ['#c9c3b4','#b8bcc0','#cbbf9e'][kind%3];
  x.fillStyle=bg; x.fillRect(0,0,256,360);
  x.fillStyle='#22242a';
  x.fillRect(16,20,224,52);
  x.fillStyle=bg; x.font='900 30px "Arial Black",Impact,sans-serif'; x.textAlign='center';
  x.fillText(['DANGER','CAUTION','NO ENTRY'][kind%3], 128, 56);
  x.fillStyle='#22242a'; x.font='bold 16px Arial';
  const lines = [['HARD HAT','AREA','ЗОНА РАБОТ'],['UNFINISHED','STRUCTURE','НЕ ВХОДИТЬ'],['AUTHORIZED','PERSONNEL','ONLY']][kind%3];
  lines.forEach((s,i)=> x.fillText(s, 128, 112+i*28));
  // пиктограмма
  x.strokeStyle='#22242a'; x.lineWidth=6;
  x.beginPath(); x.arc(128,250,52,0,7); x.stroke();
  x.beginPath(); x.moveTo(128,212); x.lineTo(128,262); x.stroke();
  x.beginPath(); x.arc(128,282,5,0,7); x.fillStyle='#22242a'; x.fill();
  // потрёпанность
  for(let i=0;i<180;i++){
    x.fillStyle=`rgba(${si(60,130)},${si(58,124)},${si(54,116)},${sr(.05,.3)})`;
    x.fillRect(srnd()*256, srnd()*360, sr(2,16), sr(1,8));
  }
  for(let i=0;i<5;i++){  // надрывы по краю
    x.clearRect(srnd()*256, srnd()<0.5?0:340, sr(10,40), sr(6,20));
  }
  grain(x,256,360,0.05);
  const t = new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=MAXA();
  return t;
}
/* ---------- Пятна на полу (лужи краски, грязь) ---------- */
/** Мутное армированное стекло: разводы, пыль, сетка. */
function dirtyGlassMaps(size=256){
  const [c,x] = cv(size,size);
  x.fillStyle='#d8e4ee'; x.fillRect(0,0,size,size);
  // потёки и налёт
  for(let i=0;i<70;i++){
    const px=srnd()*size, w=sr(3,26);
    const g=x.createLinearGradient(px,0,px,size);
    g.addColorStop(0,`rgba(${si(120,168)},${si(126,172)},${si(120,166)},${sr(.08,.3)})`);
    g.addColorStop(1,'rgba(150,155,150,0)');
    x.fillStyle=g; x.fillRect(px,0,w,size);
  }
  for(let i=0;i<120;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(4,30);
    wrapDraw(x, size, ()=>{
      const g=x.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,`rgba(${si(140,190)},${si(144,192)},${si(138,186)},${sr(.05,.22)})`);
      g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
  }
  // армирующая сетка
  x.strokeStyle='rgba(126,132,128,.30)'; x.lineWidth=1.1;
  for(let i=0;i<=size;i+=size/10){
    x.beginPath(); x.moveTo(i,0); x.lineTo(i,size); x.stroke();
    x.beginPath(); x.moveTo(0,i); x.lineTo(size,i); x.stroke();
  }
  grain(x,size,size,0.03);
  return c;
}
function stainTex(){
  const [c,x] = cv(256,256);
  x.clearRect(0,0,256,256);
  const col = spick(['rgba(58,52,44,','rgba(42,46,38,','rgba(70,54,40,','rgba(46,44,48,']);
  const cx=128, cy=128;
  x.fillStyle = col+'0.5)';
  x.beginPath();
  const pts = 16;
  for(let i=0;i<=pts;i++){
    const a = i/pts*Math.PI*2, r = 60 + Math.sin(a*3+srnd()*50)*18 + sr(-16,16);
    const px = cx+Math.cos(a)*r, py = cy+Math.sin(a)*r;
    i ? x.lineTo(px,py) : x.moveTo(px,py);
  }
  x.closePath(); x.fill();
  for(let i=0;i<9;i++){   // брызги
    const a=sr(0,6.28), d=sr(60,118);
    x.globalAlpha=sr(.2,.5);
    x.beginPath(); x.arc(cx+Math.cos(a)*d, cy+Math.sin(a)*d, sr(3,13),0,7); x.fill();
  }
  x.globalAlpha=1;
  // размытие краёв
  const img=x.getImageData(0,0,256,256), d=img.data;
  for(let i=3;i<d.length;i+=4){
    const px=((i-3)/4)%256, py=Math.floor(((i-3)/4)/256);
    const dist = Math.hypot(px-128,py-128);
    d[i] = d[i]*clamp(1.25 - dist/110, 0, 1);
  }
  x.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=MAXA();
  return t;
}

/* ---------- Пиратский флаг: «Весёлый Роджер» на потрёпанном полотнище ---------- */
function flagTex(w=512, h=320){
  const [c,x] = cv(w,h);
  // Полотнище выгоревшее: чистый чёрный на солнце становится серо-бурым.
  const g = x.createLinearGradient(0,0,w,h);
  g.addColorStop(0,'#25242a'); g.addColorStop(0.5,'#1b1a1f'); g.addColorStop(1,'#2b2930');
  x.fillStyle=g; x.fillRect(0,0,w,h);
  // переплетение ткани
  for(let i=0;i<h;i+=2){ x.fillStyle=`rgba(255,255,255,${sr(0.012,0.03)})`; x.fillRect(0,i,w,1); }
  for(let i=0;i<w;i+=2){ x.fillStyle=`rgba(0,0,0,${sr(0.01,0.028)})`; x.fillRect(i,0,1,h); }

  const cx = w*0.5, cy = h*0.44, S = h*0.0034;
  x.save(); x.translate(cx,cy); x.scale(S,S);
  x.fillStyle = '#d8d3c4';
  // кости крест-накрест
  const bone = (ang)=>{
    x.save(); x.rotate(ang);
    x.beginPath(); x.roundRect(-118, -9, 236, 18, 9); x.fill();
    for(const sx of [-1,1]) for(const sy of [-1,1]){
      x.beginPath(); x.arc(sx*124, sy*13, 15, 0, 7); x.fill();
    }
    x.restore();
  };
  bone(0.62); bone(-0.62);
  // череп
  x.beginPath(); x.ellipse(0,-14, 62, 56, 0, 0, 7); x.fill();
  x.beginPath(); x.roundRect(-34, 26, 68, 34, 12); x.fill();          // челюсть
  x.fillStyle = '#1b1a1f';
  x.beginPath(); x.ellipse(-24,-18, 19, 22, 0.12, 0, 7); x.fill();    // глазницы
  x.beginPath(); x.ellipse( 24,-18, 19, 22,-0.12, 0, 7); x.fill();
  x.beginPath(); x.moveTo(0,4); x.lineTo(-11,24); x.lineTo(11,24); x.closePath(); x.fill();  // нос
  for(let i=0;i<4;i++){ x.fillRect(-27+i*15, 28, 5, 30); }            // зубы
  x.restore();

  // выгорание и пятна
  for(let i=0;i<120;i++){
    const px=srnd()*w, py=srnd()*h, r=sr(8,60);
    const rg=x.createRadialGradient(px,py,1,px,py,r);
    rg.addColorStop(0,`rgba(${si(120,170)},${si(112,160)},${si(100,148)},${sr(.03,.12)})`);
    rg.addColorStop(1,'rgba(0,0,0,0)');
    x.fillStyle=rg; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
  }
  // рваный свободный край (по правой стороне) и дыры
  x.globalCompositeOperation='destination-out';
  for(let i=0;i<26;i++){
    const py=srnd()*h;
    x.beginPath(); x.moveTo(w, py);
    x.lineTo(w - sr(6,52), py + sr(-14,14));
    x.lineTo(w, py + sr(8,30));
    x.closePath(); x.fill();
  }
  for(let i=0;i<7;i++){
    x.beginPath(); x.ellipse(sr(w*0.25,w*0.97), srnd()*h, sr(2,11), sr(2,9), sr(0,3), 0, 7); x.fill();
  }
  x.globalCompositeOperation='source-over';
  grain(x,w,h,0.04);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=MAXA();
  return t;
}

/* ---------- Разметка вертолётной площадки ---------- */
function helipadTex(size=1024){
  const [c,x] = cv(size,size);
  const S = size/2;
  x.fillStyle='#4a4b4d'; x.fillRect(0,0,size,size);
  // асфальтовая крошка
  for(let i=0;i<9000;i++){
    const v=si(48,96);
    x.fillStyle=`rgba(${v},${v+2},${v+3},${sr(.15,.55)})`;
    x.fillRect(srnd()*size, srnd()*size, sr(1,3.4), sr(1,3.4));
  }
  // жёлтый круг TLOF и белая H
  x.strokeStyle='#c9b048'; x.lineWidth=size*0.026;
  x.beginPath(); x.arc(S,S,size*0.40,0,7); x.stroke();
  x.strokeStyle='#e4e2da'; x.lineWidth=size*0.018;
  x.beginPath(); x.arc(S,S,size*0.455,0,7); x.stroke();
  x.fillStyle='#e8e6de';
  const bw=size*0.052, bh=size*0.30, gap=size*0.115;
  x.fillRect(S-gap-bw/2, S-bh/2, bw, bh);
  x.fillRect(S+gap-bw/2, S-bh/2, bw, bh);
  x.fillRect(S-gap, S-bw/2, gap*2, bw);
  // номер площадки и предельная масса
  x.fillStyle='#d8d6cc'; x.textAlign='center'; x.textBaseline='middle';
  x.font=`700 ${Math.round(size*0.055)}px Arial,Helvetica,sans-serif`;
  x.fillText('07', S, S + size*0.245);
  x.font=`700 ${Math.round(size*0.038)}px Arial,Helvetica,sans-serif`;
  x.fillText('1.4 t', S, S - size*0.245);
  // износ: краска стирается пятнами, следы полозьев
  x.globalCompositeOperation='destination-out';
  for(let i=0;i<260;i++){
    x.globalAlpha=sr(.10,.55);
    x.beginPath(); x.ellipse(srnd()*size, srnd()*size, sr(3,26), sr(3,20), sr(0,3), 0, 7); x.fill();
  }
  x.globalAlpha=1; x.globalCompositeOperation='source-over';
  for(const sx of [-1,1]){            // потёртости от полозьев
    const px = S + sx*size*0.135;
    const gr = x.createLinearGradient(px-size*0.02,0,px+size*0.02,0);
    gr.addColorStop(0,'rgba(30,30,32,0)'); gr.addColorStop(0.5,'rgba(30,30,32,.35)');
    gr.addColorStop(1,'rgba(30,30,32,0)');
    x.fillStyle=gr; x.fillRect(px-size*0.03, S-size*0.22, size*0.06, size*0.44);
  }
  for(let i=0;i<40;i++){              // масляные потёки от редуктора
    const px=S+sr(-size*0.12,size*0.12), py=S+sr(-size*0.1,size*0.1), r=sr(4,26);
    const rg=x.createRadialGradient(px,py,1,px,py,r);
    rg.addColorStop(0,`rgba(22,20,18,${sr(.1,.36)})`); rg.addColorStop(1,'rgba(22,20,18,0)');
    x.fillStyle=rg; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
  }
  grain(x,size,size,0.05);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=MAXA();
  return t;
}

/* ---------- Разметка парковки: линии мест, стрелки, номера ---------- */
function parkingTex(size=1024){
  const [c,x] = cv(size,size);
  x.clearRect(0,0,size,size);
  // Полотно 16 x 16 м: четыре места по 2.6 м с проездом.
  const px = v => v/16*size;
  x.strokeStyle='rgba(226,220,196,.85)'; x.lineCap='butt';
  x.lineWidth = px(0.12);
  for(let i=0;i<=4;i++){
    x.beginPath(); x.moveTo(px(0.4+i*2.6), px(0.6)); x.lineTo(px(0.4+i*2.6), px(5.6)); x.stroke();
  }
  x.beginPath(); x.moveTo(px(0.4), px(5.6)); x.lineTo(px(10.8), px(5.6)); x.stroke();
  // номера мест
  x.fillStyle='rgba(226,220,196,.8)'; x.textAlign='center'; x.textBaseline='middle';
  x.font=`700 ${Math.round(px(0.7))}px Arial,sans-serif`;
  for(let i=0;i<4;i++) x.fillText('P'+(i+1), px(1.7+i*2.6), px(5.0));
  // стрелка направления движения
  x.fillStyle='rgba(226,220,196,.7)';
  x.save(); x.translate(px(12.6), px(8.0)); x.scale(px(1),px(1));
  x.beginPath(); x.moveTo(0,-2.2); x.lineTo(0.85,-0.6); x.lineTo(0.32,-0.6);
  x.lineTo(0.32,2.2); x.lineTo(-0.32,2.2); x.lineTo(-0.32,-0.6); x.lineTo(-0.85,-0.6);
  x.closePath(); x.fill(); x.restore();
  // жёлтая штриховка запретной зоны
  x.strokeStyle='rgba(198,168,74,.6)'; x.lineWidth=px(0.1);
  for(let i=0;i<12;i++){
    x.beginPath(); x.moveTo(px(0.4+i*0.5), px(14.6)); x.lineTo(px(0.9+i*0.5), px(13.4)); x.stroke();
  }
  // стёртость краски
  x.globalCompositeOperation='destination-out';
  for(let i=0;i<420;i++){
    x.globalAlpha=sr(.15,.7);
    x.beginPath(); x.ellipse(srnd()*size, srnd()*size, sr(2,16), sr(2,13), sr(0,3), 0, 7); x.fill();
  }
  x.globalAlpha=1; x.globalCompositeOperation='source-over';
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=MAXA();
  return t;
}

/* ---------- Сигнальная лента: жёлто-чёрные косые полосы ---------- */
function hazardMaps(size=256){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  x.fillStyle='#b2933f'; x.fillRect(0,0,size,size);
  hx.fillStyle='#808080'; hx.fillRect(0,0,size,size);
  rx.fillStyle='#7c7c7c'; rx.fillRect(0,0,size,size);
  x.strokeStyle='#26241f'; x.lineWidth=size*0.14;
  for(let i=-2;i<=6;i++){
    x.beginPath(); x.moveTo(i*size/3, 0); x.lineTo(i*size/3 + size, size); x.stroke();
  }
  // облезлая краска: ржавые проплешины
  for(let i=0;i<220;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(2,13);
    wrapDraw(x,size,()=>{ x.fillStyle=`rgba(${si(96,140)},${si(64,92)},${si(44,62)},${sr(.25,.7)})`;
      x.beginPath(); x.arc(px,py,r,0,7); x.fill(); });
    wrapDraw(hx,size,()=>{ const v=si(88,126); hx.fillStyle=`rgba(${v},${v},${v},.6)`;
      hx.beginPath(); hx.arc(px,py,r,0,7); hx.fill(); });
    wrapDraw(rx,size,()=>{ rx.fillStyle=`rgba(${si(150,200)},${si(150,200)},${si(150,200)},.5)`;
      rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill(); });
  }
  grain(x,size,size,0.05);
  return {albedo:c, height:h, rough:rg};
}

/* ============================================================================
   НОВЫЕ ТЕКСТУРЫ: эмблемы команд, камуфляж, декали повреждений, огонь, дым,
   решётчатый настил, воронка.
============================================================================ */
const texOf = (c, srgb=true)=>{ const t=new THREE.CanvasTexture(c); if(srgb) t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=MAXA(); return t; };

/** Камуфляж пятнами: слои цветных клякс от крупных к мелким (multicam/woodland). */
function camoCanvas(w, h, pal, scale=1){
  const [c,x] = cv(w,h);
  x.fillStyle = pal[0]; x.fillRect(0,0,w,h);
  for(let L=1; L<pal.length; L++){
    const n = Math.round(90*scale/L), rMax = 70*scale/Math.sqrt(L);
    x.fillStyle = pal[L];
    for(let i=0;i<n;i++){
      const px=srnd()*w, py=srnd()*h;
      x.beginPath();
      const pts = 9, r0 = sr(rMax*0.3, rMax);
      for(let k=0;k<=pts;k++){
        const a = k/pts*Math.PI*2, r = r0*sr(0.55,1.15);
        const qx = px+Math.cos(a)*r*1.6, qy = py+Math.sin(a)*r*0.8;
        k ? x.lineTo(qx,qy) : x.moveTo(qx,qy);
      }
      x.closePath(); x.fill();
    }
  }
  return [c,x];
}
/** Эмблема ALPHA: стилизованная «A»-шеврон с вырезом, как на референсе. */
function drawAlpha(x, cx, cy, s, col){
  x.save(); x.translate(cx,cy); x.scale(s,s); x.fillStyle=col;
  x.beginPath();
  x.moveTo(0,-100); x.lineTo(88,80); x.lineTo(48,80); x.lineTo(0,-18); x.lineTo(-48,80); x.lineTo(-88,80);
  x.closePath(); x.fill();
  x.beginPath(); x.moveTo(-22,52); x.lineTo(22,52); x.lineTo(36,80); x.lineTo(-36,80); x.closePath(); x.fill();
  x.restore();
}
/** Эмблема DELTA: треугольник с горизонтальной прорезью. */
function drawDelta(x, cx, cy, s, col){
  x.save(); x.translate(cx,cy); x.scale(s,s); x.fillStyle=col;
  x.beginPath(); x.moveTo(0,-100); x.lineTo(92,78); x.lineTo(-92,78); x.closePath(); x.fill();
  x.globalCompositeOperation='destination-out';
  x.beginPath(); x.moveTo(-58,34); x.lineTo(58,34); x.lineTo(50,48); x.lineTo(-50,48); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(0,-54); x.lineTo(10,-34); x.lineTo(-10,-34); x.closePath(); x.fill();
  x.globalCompositeOperation='source-over';
  x.restore();
}
/** Полотнище командного флага 2:1 с эмблемой и надписью. */
function teamFlagTex(team, w=1024, h=640){
  let c, x;
  if(team==='ALPHA'){
    [c,x] = cv(w,h);
    const g = x.createLinearGradient(0,0,w,h);
    g.addColorStop(0,'#1d1f22'); g.addColorStop(1,'#121315');
    x.fillStyle=g; x.fillRect(0,0,w,h);
  } else {
    [c,x] = camoCanvas(w,h, ['#6b6a4b','#4d5536','#8a7d58','#3a3d2a','#a39873','#2c2d22'], 1.6);
  }
  // ткацкое переплетение
  for(let i=0;i<h;i+=2){ x.fillStyle=`rgba(255,255,255,${sr(0.01,0.03)})`; x.fillRect(0,i,w,1); }
  for(let i=0;i<w;i+=2){ x.fillStyle=`rgba(0,0,0,${sr(0.01,0.03)})`; x.fillRect(i,0,1,h); }
  // окантовка и поле эмблемы
  x.strokeStyle = team==='ALPHA' ? 'rgba(230,232,236,.85)' : 'rgba(30,32,24,.85)';
  x.lineWidth = h*0.03; x.strokeRect(h*0.05, h*0.05, w-h*0.1, h-h*0.1);
  const col = team==='ALPHA' ? '#e9eaec' : '#20241a';
  if(team==='ALPHA') drawAlpha(x, w*0.5, h*0.42, h*0.0026, col);
  else { x.fillStyle='rgba(20,22,16,.55)'; x.beginPath(); x.arc(w*0.5,h*0.42,h*0.3,0,7); x.fill();
         drawDelta(x, w*0.5, h*0.43, h*0.0024, '#9cc27a'); }
  x.fillStyle = team==='ALPHA' ? '#e9eaec' : '#d9dccb';
  x.font = `700 ${Math.round(h*0.105)}px "Segoe UI",Roboto,Arial,sans-serif`;
  x.textAlign='center'; x.textBaseline='middle';
  const word = team.split('').join(String.fromCharCode(8202));
  x.fillText(word, w*0.5, h*0.83);
  // выгорание, грязь и потёртости по свободному краю
  for(let i=0;i<140;i++){
    const px=srnd()*w, py=srnd()*h, r=sr(8,70);
    const rg=x.createRadialGradient(px,py,1,px,py,r);
    rg.addColorStop(0,`rgba(${si(110,160)},${si(100,150)},${si(80,120)},${sr(.02,.09)})`);
    rg.addColorStop(1,'rgba(0,0,0,0)');
    x.fillStyle=rg; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
  }
  x.globalCompositeOperation='destination-out';
  for(let i=0;i<30;i++){
    const py=srnd()*h;
    x.beginPath(); x.moveTo(w, py); x.lineTo(w - sr(4,34), py + sr(-10,10)); x.lineTo(w, py + sr(6,22));
    x.closePath(); x.fill();
  }
  x.globalCompositeOperation='source-over';
  grain(x,w,h,0.035);
  return texOf(c);
}
/** Иконка эмблемы для интерфейса (data URL). */
function emblemDataURL(team, size=128){
  const [c,x] = cv(size,size);
  if(team==='ALPHA') drawAlpha(x, size/2, size*0.52, size*0.0042, '#eceef0');
  else drawDelta(x, size/2, size*0.54, size*0.0042, '#a9cf86');
  return c.toDataURL();
}

/** Атлас декалей 4x2: 0-1 дерево (пулевые), 2 бетон/металл, 3 стекло (звезда),
    4 гарь, 5 обугленная дыра, 6 скол бетона, 7 брызги сажи. */
function decalAtlas(size=1024){
  const [c,x] = cv(size, size/2);
  const S = size/4;
  x.clearRect(0,0,size,size/2);
  const cell = (i, fn)=>{ x.save(); x.translate((i%4)*S + S/2, Math.floor(i/4)*S + S/2); fn(S/2); x.restore(); };
  const woodHole = (R)=>{
    // вырванная щепа вокруг входного отверстия, светлая свежая древесина
    for(let k=0;k<26;k++){
      const a=sr(0,6.283), l=sr(R*0.18,R*0.72), w=sr(1.5,5);
      x.save(); x.rotate(a);
      x.fillStyle=`rgba(${si(214,238)},${si(186,208)},${si(130,156)},${sr(.55,.95)})`;
      x.beginPath(); x.moveTo(R*0.08,-w); x.lineTo(l,0); x.lineTo(R*0.08,w); x.closePath(); x.fill();
      x.restore();
    }
    const g=x.createRadialGradient(0,0,0,0,0,R*0.42);
    g.addColorStop(0,'rgba(8,6,4,1)'); g.addColorStop(0.45,'rgba(24,17,10,.98)');
    g.addColorStop(0.75,'rgba(90,64,36,.6)'); g.addColorStop(1,'rgba(120,90,50,0)');
    x.fillStyle=g; x.beginPath(); x.arc(0,0,R*0.42,0,7); x.fill();
    x.fillStyle='rgba(4,3,2,1)'; x.beginPath();
    for(let k=0;k<=10;k++){ const a=k/10*6.283, r=R*sr(0.10,0.16); k?x.lineTo(Math.cos(a)*r,Math.sin(a)*r):x.moveTo(Math.cos(a)*r,Math.sin(a)*r); }
    x.fill();
  };
  cell(0, woodHole); cell(1, woodHole);
  cell(2, (R)=>{   // бетон: скол с пылью
    const g=x.createRadialGradient(0,0,0,0,0,R*0.8);
    g.addColorStop(0,'rgba(30,30,30,1)'); g.addColorStop(0.25,'rgba(70,68,64,.95)');
    g.addColorStop(0.5,'rgba(170,166,158,.6)'); g.addColorStop(1,'rgba(200,196,188,0)');
    x.fillStyle=g; x.beginPath(); x.arc(0,0,R*0.8,0,7); x.fill();
    x.strokeStyle='rgba(40,40,40,.6)'; x.lineWidth=1.2;
    for(let k=0;k<7;k++){ const a=sr(0,6.28); x.beginPath(); x.moveTo(0,0);
      x.lineTo(Math.cos(a)*R*sr(0.4,0.8), Math.sin(a)*R*sr(0.4,0.8)); x.stroke(); }
  });
  cell(3, (R)=>{   // стекло: звезда трещин
    x.strokeStyle='rgba(235,242,248,.9)'; x.lineWidth=1.4;
    for(let k=0;k<14;k++){
      const a=k/14*6.283+sr(-0.15,0.15); let px=0, py=0; x.beginPath(); x.moveTo(0,0);
      for(let s=0;s<5;s++){ px+=Math.cos(a+sr(-0.3,0.3))*R*0.19; py+=Math.sin(a+sr(-0.3,0.3))*R*0.19; x.lineTo(px,py); }
      x.stroke();
    }
    for(let ring=1; ring<4; ring++){
      x.beginPath();
      for(let k=0;k<=14;k++){ const a=k/14*6.283, r=R*ring*0.22*sr(0.85,1.1); k?x.lineTo(Math.cos(a)*r,Math.sin(a)*r):x.moveTo(Math.cos(a)*r,Math.sin(a)*r); }
      x.strokeStyle=`rgba(230,238,245,${0.7-ring*0.15})`; x.stroke();
    }
    x.fillStyle='rgba(20,24,28,.95)'; x.beginPath(); x.arc(0,0,R*0.06,0,7); x.fill();
  });
  cell(4, (R)=>{   // гарь от взрыва
    for(let k=0;k<40;k++){
      const a=sr(0,6.283), d=sr(0,R*0.6), r=sr(R*0.15,R*0.45);
      const g=x.createRadialGradient(Math.cos(a)*d,Math.sin(a)*d,0,Math.cos(a)*d,Math.sin(a)*d,r);
      g.addColorStop(0,`rgba(12,10,9,${sr(.25,.5)})`); g.addColorStop(1,'rgba(12,10,9,0)');
      x.fillStyle=g; x.beginPath(); x.arc(Math.cos(a)*d,Math.sin(a)*d,r,0,7); x.fill();
    }
    for(let k=0;k<30;k++){  // лучи выброса
      const a=sr(0,6.283); x.strokeStyle=`rgba(14,12,10,${sr(.15,.4)})`; x.lineWidth=sr(2,7);
      x.beginPath(); x.moveTo(Math.cos(a)*R*0.3,Math.sin(a)*R*0.3); x.lineTo(Math.cos(a)*R*sr(0.7,0.98),Math.sin(a)*R*sr(0.7,0.98)); x.stroke();
    }
  });
  cell(5, (R)=>{   // обугленная кромка дыры
    const g=x.createRadialGradient(0,0,R*0.2,0,0,R*0.95);
    g.addColorStop(0,'rgba(5,4,3,1)'); g.addColorStop(0.5,'rgba(22,15,9,.9)'); g.addColorStop(0.8,'rgba(60,38,20,.45)'); g.addColorStop(1,'rgba(60,38,20,0)');
    x.fillStyle=g; x.beginPath(); x.arc(0,0,R*0.95,0,7); x.fill();
  });
  cell(6, (R)=>{   // скол бетона крупный
    x.fillStyle='rgba(60,58,54,.9)'; x.beginPath();
    for(let k=0;k<=12;k++){ const a=k/12*6.283, r=R*sr(0.3,0.6); k?x.lineTo(Math.cos(a)*r,Math.sin(a)*r):x.moveTo(Math.cos(a)*r,Math.sin(a)*r); }
    x.fill();
    const g=x.createRadialGradient(0,0,R*0.3,0,0,R); g.addColorStop(0,'rgba(190,186,176,.5)'); g.addColorStop(1,'rgba(190,186,176,0)');
    x.fillStyle=g; x.beginPath(); x.arc(0,0,R,0,7); x.fill();
  });
  cell(7, (R)=>{   // брызги сажи
    for(let k=0;k<60;k++){ const a=sr(0,6.283), d=sr(0,R*0.9);
      x.fillStyle=`rgba(16,14,12,${sr(.2,.6)})`; x.beginPath(); x.arc(Math.cos(a)*d,Math.sin(a)*d,sr(1,5),0,7); x.fill(); }
  });
  return texOf(c);
}

/** Воронка: albedo с альфой + карта высот (впадина, вал выброса по кромке). */
function craterMaps(size=512){
  const [c,x] = cv(size,size), [h,hx] = cv(size,size);
  const C = size/2;
  x.clearRect(0,0,size,size);
  hx.fillStyle='rgb(128,128,128)'; hx.fillRect(0,0,size,size);
  const img = hx.getImageData(0,0,size,size), d = img.data;
  const ph = [sr(0,6),sr(0,6),sr(0,6)];
  for(let py=0;py<size;py++) for(let px=0;px<size;px++){
    const dx=(px-C)/C, dy=(py-C)/C, r=Math.hypot(dx,dy), a=Math.atan2(dy,dx);
    const wob = 1 + 0.08*Math.sin(a*5+ph[0]) + 0.05*Math.sin(a*11+ph[1]) + 0.03*Math.sin(a*23+ph[2]);
    const rr = r/wob;
    let hv = 0;
    if(rr < 0.55) hv = -Math.cos(rr/0.55*Math.PI/2)*0.9;          // чаша
    else if(rr < 0.8) hv = Math.sin((rr-0.55)/0.25*Math.PI)*0.35;  // вал
    hv += (Math.random()-0.5)*0.12;
    const v = clamp(128 + hv*110, 0, 255), i=(py*size+px)*4;
    d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
  }
  hx.putImageData(img,0,0);
  // albedo: тёмная чаша, выбитый бетон, копоть лучами
  for(let k=0;k<50;k++){
    const a=sr(0,6.283), dd=sr(0,C*0.5), r=sr(C*0.1,C*0.35);
    const g=x.createRadialGradient(C+Math.cos(a)*dd,C+Math.sin(a)*dd,0,C+Math.cos(a)*dd,C+Math.sin(a)*dd,r);
    g.addColorStop(0,`rgba(${si(40,70)},${si(38,64)},${si(34,58)},${sr(.5,.8)})`); g.addColorStop(1,'rgba(40,38,34,0)');
    x.fillStyle=g; x.beginPath(); x.arc(C+Math.cos(a)*dd,C+Math.sin(a)*dd,r,0,7); x.fill();
  }
  for(let k=0;k<80;k++){ // крошка по валу
    const a=sr(0,6.283), dd=C*sr(0.45,0.85);
    x.fillStyle=`rgba(${si(120,170)},${si(116,164)},${si(108,154)},${sr(.5,.9)})`;
    x.beginPath(); x.arc(C+Math.cos(a)*dd, C+Math.sin(a)*dd, sr(2,7), 0, 7); x.fill();
  }
  for(let k=0;k<36;k++){
    const a=sr(0,6.283); x.strokeStyle=`rgba(14,12,10,${sr(.12,.35)})`; x.lineWidth=sr(3,10);
    x.beginPath(); x.moveTo(C+Math.cos(a)*C*0.4,C+Math.sin(a)*C*0.4); x.lineTo(C+Math.cos(a)*C*sr(0.75,1.0),C+Math.sin(a)*C*sr(0.75,1.0)); x.stroke();
  }
  const g=x.createRadialGradient(C,C,0,C,C,C*0.3); g.addColorStop(0,'rgba(10,9,8,.85)'); g.addColorStop(1,'rgba(10,9,8,0)');
  x.fillStyle=g; x.beginPath(); x.arc(C,C,C*0.3,0,7); x.fill();
  // мягкая кромка
  const im=x.getImageData(0,0,size,size), q=im.data;
  for(let i=3;i<q.length;i+=4){ const p=(i-3)/4, px=p%size, py=Math.floor(p/size);
    const r=Math.hypot(px-C,py-C)/C; q[i]=q[i]*clamp((1.0-r)/0.18,0,1); }
  x.putImageData(im,0,0);
  const nrm = heightToNormal(h, 6.0);
  return { map: texOf(c), normal: texOf(nrm,false) };
}

/** Спрайт пламени: вертикальный язык с горячим ядром (для аддитивных частиц). */
function flameTex(size=128){
  const [c,x] = cv(size,size);
  const img = x.createImageData(size,size), d = img.data;
  for(let py=0;py<size;py++) for(let px=0;px<size;px++){
    const u=(px/size-0.5)*2, v=py/size;              // v: 0 верх, 1 низ
    const w = 0.25 + 0.75*Math.pow(v, 0.7);
    const r = Math.abs(u)/w;
    let a = clamp(1-r,0,1) * smoothstepJS(0.0,0.35,v) * smoothstepJS(1.0,0.72,v);
    a = Math.pow(a, 1.3);
    const i=(py*size+px)*4;
    d[i]=255; d[i+1]=Math.round(150+105*a); d[i+2]=Math.round(60+150*a*a); d[i+3]=Math.round(255*a);
  }
  x.putImageData(img,0,0);
  return texOf(c);
}
function smoothstepJS(a,b,x){ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
/** Клуб дыма: мягкая неровная клякса. */
function smokeTex(size=128){
  const [c,x] = cv(size,size);
  const C=size/2;
  for(let k=0;k<22;k++){
    const a=sr(0,6.283), dd=sr(0,C*0.42), r=sr(C*0.25,C*0.55);
    const g=x.createRadialGradient(C+Math.cos(a)*dd,C+Math.sin(a)*dd,0,C+Math.cos(a)*dd,C+Math.sin(a)*dd,r);
    g.addColorStop(0,'rgba(255,255,255,.22)'); g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g; x.beginPath(); x.arc(C+Math.cos(a)*dd,C+Math.sin(a)*dd,r,0,7); x.fill();
  }
  return texOf(c);
}
/** Мягкая точка для искр и вспышек. */
function glowTex(size=64){
  const [c,x] = cv(size,size);
  const g=x.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.25,'rgba(255,240,200,.8)'); g.addColorStop(1,'rgba(255,200,120,0)');
  x.fillStyle=g; x.fillRect(0,0,size,size);
  return texOf(c);
}
/** Просечно-вытяжной/решётчатый настил: albedo + альфа по прорезям. */
function gratingMaps(size=256){
  const [c,x] = cv(size,size), [h,hx] = cv(size,size);
  x.fillStyle='#000'; x.fillRect(0,0,size,size); hx.fillStyle='#000'; hx.fillRect(0,0,size,size);
  const n=8, s=size/n;
  for(let i=0;i<=n;i++){
    x.fillStyle='#5b5752'; x.fillRect(i*s-3,0,6,size);               // несущие полосы
    hx.fillStyle='#fff'; hx.fillRect(i*s-3,0,6,size);
  }
  for(let j=0;j<=n*2;j++){
    x.fillStyle='#4e4a45'; x.fillRect(0,j*s/2-1.5,size,3);            // связи
    hx.fillStyle='#ccc'; hx.fillRect(0,j*s/2-1.5,size,3);
  }
  // ржавчина на кромках
  for(let k=0;k<400;k++){ x.fillStyle=`rgba(${si(90,130)},${si(50,70)},${si(30,40)},${sr(.1,.4)})`;
    x.fillRect(srnd()*size, srnd()*size, sr(1,4), sr(1,4)); }
  const alpha = x.getImageData(0,0,size,size); const hd = hx.getImageData(0,0,size,size).data;
  for(let i=0;i<alpha.data.length;i+=4) alpha.data[i+3] = hd[i] > 20 ? 255 : 0;
  x.putImageData(alpha,0,0);
  return {albedo:c, height:h};
}

export { cv, wrapDraw, grain, heightToAO, heightToNormal, MAXA, T, osbMaps, concreteMaps, lumberMaps,
         corrugatedMaps, steelMaps, panelMaps, graffitiTex, posterTex, dirtyGlassMaps, stainTex,
         flagTex, helipadTex, parkingTex, hazardMaps, camoCanvas, teamFlagTex, emblemDataURL,
         decalAtlas, craterMaps, flameTex, smokeTex, glowTex, gratingMaps, texOf };
