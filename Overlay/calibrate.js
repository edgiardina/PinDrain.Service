// Calibration page: video underlay + quad editor (Tab 1), ROI polygon editor with warped snapshot (Tab 2)

// Run after DOM is fully parsed
window.addEventListener('DOMContentLoaded', () => {
  // ============== Quad Editor ==============
  const mode     = document.getElementById('mode');
  const device   = document.getElementById('device');
  const camWrap  = document.getElementById('camWrap');
  const pickBtn  = document.getElementById('pickBtn');
  const saveBtn  = document.getElementById('saveBtn');
  const msg      = document.getElementById('msg');
  const feed     = document.getElementById('feed');
  const canvas   = document.getElementById('cal') || document.getElementById('calCanvas');
  const ctx      = canvas ? canvas.getContext('2d') : null;
  const camId    = document.getElementById('camId');
  const camName  = document.getElementById('camName');
  const lockRect = document.getElementById('lockRect');
  const stage    = document.getElementById('stage');
  const screenHint = document.getElementById('screenHint');

  if (!mode || !device || !pickBtn || !saveBtn || !feed || !canvas || !ctx || !camId || !camName || !lockRect || !stage) {
    console.error('Calibration DOM not ready. Missing one or more elements.');
    return;
  }

  let stream = null;
  let rafId  = 0;
  let quad = null; // [{x,y}*4]
  const handleR = 8;
  let dragging = -1;            // 0..3 or -1
  let draggingPoly = false;     // drag whole quad
  let lastMX = 0, lastMY = 0;

  function ensureInitialQuad() {
    if (quad) return;
    const w = canvas.width || 1280, h = canvas.height || 720;
    const padX = Math.round(w * 0.15), padY = Math.round(h * 0.08);
    quad = [
      { x: padX,       y: padY },
      { x: w - padX,   y: padY + 5 },
      { x: w - padX/2, y: h - padY },
      { x: padX/2,     y: h - padY }
    ];
  }
  function drawOverlay() {
    ensureInitialQuad();
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    ctx.beginPath(); ctx.moveTo(quad[0].x, quad[0].y); for (let i=1;i<4;i++) ctx.lineTo(quad[i].x, quad[i].y); ctx.closePath();
    ctx.fillStyle = 'rgba(30,136,229,0.15)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1e88e5'; ctx.stroke();
    for (let i=0;i<4;i++){ const p=quad[i]; ctx.beginPath(); ctx.arc(p.x,p.y,handleR,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill(); ctx.strokeStyle='#1e88e5'; ctx.stroke(); ctx.fillStyle='#111'; ctx.fillText(['TL','TR','BR','BL'][i], p.x+10,p.y-10); }
  }
  function hitHandle(mx,my){ for(let i=0;i<4;i++){ const p=quad[i]; const dx=mx-p.x,dy=my-p.y; if(dx*dx+dy*dy<=handleR*handleR*2) return i; } return -1; }
  function pointInPoly(px,py){ let inside=false; for(let i=0,j=3;i<4;j=i++){ const xi=quad[i].x, yi=quad[i].y, xj=quad[j].x, yj=quad[j].y; const inter=((yi>py)!==(yj>py)) && (px < (xj-xi)*(py-yi)/((yj-yi)||1e-6)+xi); if(inter) inside=!inside; } return inside; }
  function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }

  canvas.addEventListener('pointerdown', e => {
    const r=canvas.getBoundingClientRect(); const mx=(e.clientX-r.left)*(canvas.width/r.width); const my=(e.clientY-r.top)*(canvas.height/r.height);
    const hi=hitHandle(mx,my);
    if(hi>=0){ dragging=hi; draggingPoly=false; }
    else if(pointInPoly(mx,my)){ dragging=-1; draggingPoly=true; lastMX=mx; lastMY=my; }
    else { dragging=-1; draggingPoly=false; }
  });
  canvas.addEventListener('pointermove', e => {
    const r=canvas.getBoundingClientRect(); const mx=(e.clientX-r.left)*(canvas.width/r.width); const my=(e.clientY-r.top)*(canvas.height/r.height);
    const margin=handleR;
    if(dragging>=0){ quad[dragging]={ x:clamp(mx,margin,canvas.width-margin), y:clamp(my,margin,canvas.height-margin) }; drawOverlay(); return; }
    if(draggingPoly){ const dx=mx-lastMX, dy=my-lastMY; let minDx=-Infinity,maxDx=Infinity,minDy=-Infinity,maxDy=Infinity; for(const p of quad){ minDx=Math.max(minDx, margin-p.x); maxDx=Math.min(maxDx, (canvas.width-margin)-p.x); minDy=Math.max(minDy, margin-p.y); maxDy=Math.min(maxDy, (canvas.height-margin)-p.y); } const adx=clamp(dx,minDx,maxDx), ady=clamp(dy,minDy,maxDy); if(adx||ady){ quad=quad.map(p=>({x:p.x+adx,y:p.y+ady})); lastMX=mx; lastMY=my; drawOverlay(); } }
  });
  canvas.addEventListener('pointerup', ()=>{ dragging=-1; draggingPoly=false; });
  canvas.addEventListener('pointerleave', ()=>{ dragging=-1; draggingPoly=false; });

  async function listCameras(){ try{ const devs=await navigator.mediaDevices.enumerateDevices(); const cams=devs.filter(d=>d.kind==='videoinput'); device.innerHTML=''; cams.forEach((c,i)=>{ const opt=document.createElement('option'); opt.value=c.deviceId; opt.textContent=c.label||`Camera ${i+1}`; device.appendChild(opt); }); const obs=[...device.options].find(o=>/obs|virtual/i.test(o.textContent)); if(obs) device.value=obs.value; } catch{} }
  async function startCamera(deviceId){ stopStream(); const constraints=deviceId?{deviceId:{exact:deviceId}}:true; stream=await navigator.mediaDevices.getUserMedia({video:constraints,audio:false}); await attachStream(stream); }
  async function startScreen(){ stopStream(); try{ stream=await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' } , audio:false }); } catch { return; } await attachStream(stream); }
  async function attachStream(s){ feed.srcObject=s; await feed.play().catch(()=>{}); await new Promise(res=>{ if(feed.videoWidth&&feed.videoHeight) return res(); feed.onloadedmetadata=()=>res(); setTimeout(res,500); }); const w=feed.videoWidth||1280, h=feed.videoHeight||720, oldW=canvas.width||1280, oldH=canvas.height||720; canvas.width=w; canvas.height=h; feed.width=w; feed.height=h; stage.style.width=w+'px'; stage.style.height=h+'px'; if(quad && !lockRect.checked && (oldW!==w||oldH!==h)){ const sx=w/oldW, sy=h/oldH; quad=quad.map(p=>({x:p.x*sx,y:p.y*sy})); } ensureInitialQuad(); const margin=handleR; quad=quad.map(p=>({ x:clamp(p.x,margin,canvas.width-margin), y:clamp(p.y,margin,canvas.height-margin) })); cancelAnimationFrame(rafId); const tick=()=>{ drawOverlay(); rafId=requestAnimationFrame(tick); }; rafId=requestAnimationFrame(tick); }
  function stopStream(){ if(stream) stream.getTracks().forEach(t=>t.stop()); stream=null; }
  mode.onchange=async()=>{ const m=mode.value; camWrap.hidden=(m!=='camera'); pickBtn.hidden=(m!=='screen'); if (screenHint) screenHint.hidden = (m!=='screen'); if(m==='camera'){ await listCameras(); if(device.value) await startCamera(device.value); } else if(m==='screen'){ /* wait for user click due to browser gesture requirement */ } else { stopStream(); } };
  device.onchange=async()=>{ if(mode.value==='camera') await startCamera(device.value); };
  pickBtn.onclick=async()=>{ if(mode.value==='screen') await startScreen(); };
  saveBtn.onclick=async()=>{
    const body={
      id:camId.value.trim()||'scene-1',
      name:camName.value.trim()||'DeskCam',
      canonical:{width:1000,height:2000},
      quad:quad.map(p=>({x:Math.round(p.x),y:Math.round(p.y)}))
    };
    const res=await fetch('/api/profiles/camera',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    msg.textContent=res.ok?'Saved ?':'Save failed';
    setTimeout(()=>msg.textContent='',2000);
  };

  // ============== Tabs + ROI Editor ==============
  const tabQuad   = document.getElementById('tabQuad');
  const tabRoi    = document.getElementById('tabRoi');
  const paneQuad  = document.getElementById('paneQuad');
  const roiPane   = document.getElementById('roiPane');
  const snapBtn   = document.getElementById('snapBtn');
  const roiSelect = document.getElementById('roiSelect');
  const roiClear  = document.getElementById('roiClear');
  const roiCanvas = document.getElementById('roiCanvas');
  const rctx      = roiCanvas.getContext('2d');
  const gameId    = document.getElementById('gameId');
  const gameName  = document.getElementById('gameName');
  const saveGame  = document.getElementById('saveGame');
  const activate  = document.getElementById('activate');
  const roiMsg    = document.getElementById('roiMsg');

  const CAN = { width: 1000, height: 2000 };
  let roiBg = null; // ImageBitmap
  const rois = { leftOutlane:[], centerDrain:[], rightOutlane:[] };

  function drawRois(){ rctx.clearRect(0,0,roiCanvas.width,roiCanvas.height); if(roiBg) rctx.drawImage(roiBg,0,0,roiCanvas.width,roiCanvas.height); const colors={ leftOutlane:'rgba(0,200,255,0.35)', centerDrain:'rgba(255,80,80,0.35)', rightOutlane:'rgba(0,255,130,0.35)'}; const strokes={ leftOutlane:'#00c8ff', centerDrain:'#ff5050', rightOutlane:'#00ff82'}; for(const key of Object.keys(rois)){ const pts=rois[key]; if(!pts.length) continue; rctx.beginPath(); rctx.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) rctx.lineTo(pts[i][0],pts[i][1]); rctx.closePath(); rctx.fillStyle=colors[key]; rctx.fill(); rctx.lineWidth=2; rctx.strokeStyle=strokes[key]; rctx.stroke(); } const active=roiSelect.value; const pts=rois[active]; rctx.fillStyle='#fff'; rctx.strokeStyle=strokes[active]; for(const p of pts){ rctx.beginPath(); rctx.arc(p[0],p[1],5,0,Math.PI*2); rctx.fill(); rctx.stroke(); } }
  function roiHit(mx,my){ const pts=rois[roiSelect.value]; for(let i=0;i<pts.length;i++){ const dx=mx-pts[i][0], dy=my-pts[i][1]; if(dx*dx+dy*dy<=25) return i; } return -1; }
  let roiDrag=-1;
  roiCanvas.addEventListener('pointerdown', e=>{ const r=roiCanvas.getBoundingClientRect(); const mx=(e.clientX-r.left)*(roiCanvas.width/r.width); const my=(e.clientY-r.top)*(roiCanvas.height/r.height); const i=roiHit(mx,my); if(i>=0){ roiDrag=i; return; } rois[roiSelect.value].push([Math.round(mx),Math.round(my)]); drawRois(); });
  roiCanvas.addEventListener('pointermove', e=>{ if(roiDrag<0) return; const r=roiCanvas.getBoundingClientRect(); const mx=(e.clientX-r.left)*(roiCanvas.width/r.width); const my=(e.clientY-r.top)*(roiCanvas.height/r.height); rois[roiSelect.value][roiDrag]=[ Math.max(0,Math.min(roiCanvas.width,Math.round(mx))), Math.max(0,Math.min(roiCanvas.height,Math.round(my))) ]; drawRois(); });
  roiCanvas.addEventListener('pointerup', ()=>roiDrag=-1); roiCanvas.addEventListener('pointerleave', ()=>roiDrag=-1);
  document.addEventListener('keydown', e=>{ if(e.key==='Backspace'||e.key==='Delete'){ const arr=rois[roiSelect.value]; if(arr.length>0){ arr.pop(); drawRois(); } } });
  roiClear.onclick=()=>{ rois[roiSelect.value]=[]; drawRois(); };
  function showQuad(){ tabQuad.classList.add('active'); tabRoi.classList.remove('active'); paneQuad.style.display='block'; roiPane.style.display='none'; }
  function showRoi(){ tabRoi.classList.add('active'); tabQuad.classList.remove('active'); paneQuad.style.display='none'; roiPane.style.display='block'; drawRois(); }
  tabQuad.onclick=showQuad; tabRoi.onclick=showRoi;

  snapBtn.onclick=async()=>{ if(!feed.videoWidth||!feed.videoHeight||!quad) return; const tmp=document.createElement('canvas'); tmp.width=feed.videoWidth; tmp.height=feed.videoHeight; tmp.getContext('2d').drawImage(feed,0,0); const dataUrl=tmp.toDataURL('image/png'); const body={ canonical:{width:CAN.width,height:CAN.height}, quad:quad.map(p=>({x:p.x,y:p.y})), imageBase64:dataUrl }; const res=await fetch('/api/calibrate/warp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); if(!res.ok){ roiMsg.textContent='Warp failed'; setTimeout(()=>roiMsg.textContent='',2000); return; } const blob=await res.blob(); roiBg=await createImageBitmap(blob); drawRois(); };

  saveGame.onclick=async()=>{ const body={ id:gameId.value.trim()||'generic-pin', name:gameName.value.trim()||'Generic Pin', canonical:{width:CAN.width,height:CAN.height}, rois }; const res=await fetch('/api/profiles/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); roiMsg.textContent=res.ok?'Saved ?':'Save failed'; setTimeout(()=>roiMsg.textContent='',2000); };
  activate.onclick=async()=>{ const body={ cameraId: (camId?.value||'scene-1'), gameId: gameId.value.trim()||'generic-pin' }; const res=await fetch('/api/profiles/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); roiMsg.textContent=res.ok?'Activated ?':'Activate failed'; setTimeout(()=>roiMsg.textContent='',2000); };

  roiCanvas.width=CAN.width; roiCanvas.height=CAN.height; drawRois();

  // kick off
  (async function init(){ await listCameras().catch(()=>{}); mode.value='camera'; mode.onchange(); drawOverlay(); })();
});
