// PinDrain Dashboard - Extended calibration interface with system management
// Includes all calibration features plus URLs, status monitoring, and reset functionality

window.addEventListener('DOMContentLoaded', () => {
  // ============== Element Discovery ==============
  const mode     = document.getElementById('mode');
  const device   = document.getElementById('device');
  const camWrap  = document.getElementById('camWrap');
  const pickBtn  = document.getElementById('pickBtn');
  const saveBtn  = document.getElementById('saveBtn');
  const msg      = document.getElementById('msg');
  const feed     = document.getElementById('feed');
  const canvas   = document.getElementById('cal');
  const ctx      = canvas ? canvas.getContext('2d') : null;
  const camId    = document.getElementById('camId');
  const camName  = document.getElementById('camName');
  const lockRect = document.getElementById('lockRect');
  const stage    = document.getElementById('stage');
  const screenHint = document.getElementById('screenHint');

  // Server video settings
  const vidModeSel  = document.getElementById('vidModeSel');
  const vidDeviceId = document.getElementById('vidDeviceId');
  const vidFilePath = document.getElementById('vidFilePath');
  const vidStreamUrl= document.getElementById('vidStreamUrl');
  const vidDevWrap  = document.getElementById('vidDevWrap');
  const vidFileWrap = document.getElementById('vidFileWrap');
  const vidUrlWrap  = document.getElementById('vidUrlWrap');
  const vidSave     = document.getElementById('vidSave');
  const vidMsg      = document.getElementById('vidMsg');

  // Dashboard elements
  const resetBtn    = document.getElementById('resetBtn');
  const statusFps   = document.getElementById('statusFps');
  const statusDrains= document.getElementById('statusDrains');
  const statusTracks= document.getElementById('statusTracks');
  const statusFrame = document.getElementById('statusFrame');

  // Tabs and panes
  const tabQuad   = document.getElementById('tabQuad');
  const tabRoi    = document.getElementById('tabRoi');
  const tabLive   = document.getElementById('tabLive');
  const tabUrls   = document.getElementById('tabUrls');
  const tabStatus = document.getElementById('tabStatus');
  const paneQuad  = document.getElementById('paneQuad');
  const roiPane   = document.getElementById('roiPane');
  const livePane  = document.getElementById('livePane');
  const urlsPane  = document.getElementById('urlsPane');
  const statusPane= document.getElementById('statusPane');

  // ROI elements
  const snapBtn   = document.getElementById('snapBtn');
  const roiSelect = document.getElementById('roiSelect');
  const roiClear  = document.getElementById('roiClear');
  const roiCanvas = document.getElementById('roiCanvas');
  const rctx      = roiCanvas ? roiCanvas.getContext('2d') : null;
  const gameId    = document.getElementById('gameId');
  const gameName  = document.getElementById('gameName');
  const saveGame  = document.getElementById('saveGame');
  const activate  = document.getElementById('activate');
  const roiMsg    = document.getElementById('roiMsg');

  // Validate required elements
  const requiredElements = {
    mode, device, pickBtn, saveBtn, feed, canvas, ctx, camId, camName, lockRect, stage,
    vidModeSel, vidDeviceId, vidSave, tabQuad, tabRoi, tabLive, paneQuad, roiPane, livePane,
    resetBtn, tabUrls, tabStatus, urlsPane, statusPane
  };
  
  const missingElements = Object.entries(requiredElements)
    .filter(([name, element]) => !element)
    .map(([name]) => name);
    
  if (missingElements.length > 0) {
    console.error('Missing DOM elements:', missingElements);
    alert('Dashboard not ready. Missing elements: ' + missingElements.join(', '));
    return;
  }

  // ============== Dashboard Features ==============
  
  // Reset drain counts
  resetBtn.onclick = async () => {
    if (confirm('Reset all drain counts? This will clear session statistics.')) {
      try {
        const res = await fetch('/api/session/reset', { method: 'POST' });
        if (res.ok) {
          resetBtn.textContent = 'Reset ?';
          setTimeout(() => resetBtn.textContent = 'Reset Drain Counts', 2000);
          updateStatus(); // Refresh status display
        } else {
          resetBtn.textContent = 'Reset Failed';
          setTimeout(() => resetBtn.textContent = 'Reset Drain Counts', 2000);
        }
      } catch (error) {
        console.error('Reset failed:', error);
        resetBtn.textContent = 'Reset Error';
        setTimeout(() => resetBtn.textContent = 'Reset Drain Counts', 2000);
      }
    }
  };

  // Status monitoring
  async function updateStatus() {
    try {
      const [stateRes, statsRes] = await Promise.all([
        fetch('/api/debug/state'),
        fetch('/api/stats')
      ]);
      
      if (stateRes.ok) {
        const state = await stateRes.json();
        statusFrame.textContent = `${state.width}×${state.height}`;
        statusTracks.textContent = state.tracks || 0;
        // Calculate approximate FPS if we have frame data
        if (state.frames > 0 && state.ts) {
          const now = Date.now();
          const elapsed = (now - new Date(state.ts).getTime()) / 1000;
          if (elapsed > 0 && elapsed < 10) { // Only show if recent
            statusFps.textContent = Math.round(state.frames / Math.max(elapsed, 1));
          } else {
            statusFps.textContent = '--';
          }
        }
      }
      
      if (statsRes.ok) {
        const stats = await statsRes.json();
        const lanes = stats.lanes || {};
        const total = (lanes.L?.count || 0) + (lanes.C?.count || 0) + (lanes.R?.count || 0);
        statusDrains.textContent = total;
      }
    } catch (error) {
      console.error('Status update failed:', error);
    }
  }

  // Tab switching with better organization
  function showPane(activeTab, activePane) {
    // Remove active from all tabs
    [tabQuad, tabRoi, tabLive, tabUrls, tabStatus].forEach(tab => tab?.classList.remove('active'));
    // Hide all panes
    [paneQuad, roiPane, livePane, urlsPane, statusPane].forEach(pane => {
      if (pane) pane.classList.remove('active');
    });
    
    // Activate selected
    activeTab?.classList.add('active');
    activePane?.classList.add('active');
    
    // Special actions for certain panes
    if (activePane === roiPane) drawRois();
    if (activePane === statusPane) updateStatus();
  }

  // Tab event handlers
  if (tabQuad) tabQuad.onclick = () => showPane(tabQuad, paneQuad);
  if (tabRoi) tabRoi.onclick = () => showPane(tabRoi, roiPane);
  if (tabLive) tabLive.onclick = () => showPane(tabLive, livePane);
  if (tabUrls) tabUrls.onclick = () => showPane(tabUrls, urlsPane);
  if (tabStatus) tabStatus.onclick = () => showPane(tabStatus, statusPane);

  // ============== Camera Setup (from calibrate.js) ==============
  
  feed.style.pointerEvents = 'none';
  canvas.style.pointerEvents = 'auto';

  let stream = null;
  let rafId  = 0;
  let quad = null;
  const handleR = 8;
  let dragging = -1;
  let draggingPoly = false;
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
    ctx.beginPath(); 
    ctx.moveTo(quad[0].x, quad[0].y); 
    for (let i=1;i<4;i++) ctx.lineTo(quad[i].x, quad[i].y); 
    ctx.closePath();
    ctx.fillStyle = 'rgba(30,136,229,0.15)'; 
    ctx.fill(); 
    ctx.lineWidth = 2; 
    ctx.strokeStyle = '#1e88e5'; 
    ctx.stroke();
    for (let i=0;i<4;i++){ 
      const p=quad[i]; 
      ctx.beginPath(); 
      ctx.arc(p.x,p.y,handleR,0,Math.PI*2); 
      ctx.fillStyle='#fff'; 
      ctx.fill(); 
      ctx.strokeStyle='#1e88e5'; 
      ctx.stroke(); 
      ctx.fillStyle='#111'; 
      ctx.fillText(['TL','TR','BR','BL'][i], p.x+10,p.y-10); 
    }
  }

  function hitHandle(mx,my){ 
    for(let i=0;i<4;i++){ 
      const p=quad[i]; 
      const dx=mx-p.x,dy=my-p.y; 
      if(dx*dx+dy*dy<=handleR*handleR*2) return i; 
    } 
    return -1; 
  }

  function pointInPoly(px,py){ 
    let inside=false; 
    for(let i=0,j=3;i<4;j=i++){ 
      const xi=quad[i].x, yi=quad[i].y, xj=quad[j].x, yj=quad[j].y; 
      const inter=((yi>py)!==(yj>py)) && (px < (xj-xi)*(py-yi)/((yj-yi)||1e-6)+xi); 
      if(inter) inside=!inside; 
    } 
    return inside; 
  }

  function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }

  function orderedQuad(q){
    const pts = q.slice();
    pts.sort((a,b)=>a.y-b.y);
    const top = pts.slice(0,2).sort((a,b)=>a.x-b.x);
    const bot = pts.slice(2,4).sort((a,b)=>a.x-b.x);
    return [ top[0], top[1], bot[1], bot[0] ];
  }

  // Canvas event handlers
  canvas.addEventListener('pointerdown', e => {
    const r=canvas.getBoundingClientRect(); 
    const mx=(e.clientX-r.left)*(canvas.width/r.width); 
    const my=(e.clientY-r.top)*(canvas.height/r.height);
    const hi=hitHandle(mx,my);
    if(hi>=0){ dragging=hi; draggingPoly=false; }
    else if(pointInPoly(mx,my)){ dragging=-1; draggingPoly=true; lastMX=mx; lastMY=my; }
    else { dragging=-1; draggingPoly=false; }
  });

  canvas.addEventListener('pointermove', e => {
    const r=canvas.getBoundingClientRect(); 
    const mx=(e.clientX-r.left)*(canvas.width/r.width); 
    const my=(e.clientY-r.top)*(canvas.height/r.height);
    const margin=handleR;
    if(dragging>=0){ 
      quad[dragging]={ x:clamp(mx,margin,canvas.width-margin), y:clamp(my,margin,canvas.height-margin) }; 
      drawOverlay(); 
      return; 
    }
    if(draggingPoly){ 
      const dx=mx-lastMX, dy=my-lastMY; 
      let minDx=-Infinity,maxDx=Infinity,minDy=-Infinity,maxDy=Infinity; 
      for(const p of quad){ 
        minDx=Math.max(minDx, margin-p.x); 
        maxDx=Math.min(maxDx, (canvas.width-margin)-p.x); 
        minDy=Math.max(minDy, margin-p.y); 
        maxDy=Math.min(maxDy, (canvas.height-margin)-p.y); 
      } 
      const adx=clamp(dx,minDx,maxDx), ady=clamp(dy,minDy,maxDy); 
      if(adx||ady){ 
        quad=quad.map(p=>({x:p.x+adx,y:p.y+ady})); 
        lastMX=mx; lastMY=my; 
        drawOverlay(); 
      } 
    }
  });

  canvas.addEventListener('pointerup', ()=>{ dragging=-1; draggingPoly=false; });
  canvas.addEventListener('pointerleave', ()=>{ dragging=-1; draggingPoly=false; });

  // Video settings
  function updateVidInputs() {
    const m = vidModeSel.value;
    vidDevWrap.hidden = (m !== 'device');
    vidFileWrap.hidden = (m !== 'file');
    vidUrlWrap.hidden = (m !== 'url');
  }
  vidModeSel.onchange = updateVidInputs;

  async function loadVideoSettings(){
    try{
      const res = await fetch('/api/settings/video');
      if(!res.ok) return;
      const v = await res.json();
      vidModeSel.value = v.mode || 'device';
      vidDeviceId.value = v.deviceId ?? 0;
      vidFilePath.value = v.filePath || '';
      vidStreamUrl.value = v.streamUrl || '';
      updateVidInputs();
    } catch {}
  }

  vidSave.onclick = async ()=>{
    const body = {
      mode: vidModeSel.value,
      deviceId: vidModeSel.value==='device' ? Number(vidDeviceId.value) : null,
      filePath: vidModeSel.value==='file' ? vidFilePath.value : null,
      streamUrl: vidModeSel.value==='url' ? vidStreamUrl.value : null,
      width: null, height: null, fps: null, flipH:false, flipV:false, rotate:0
    };
    const res = await fetch('/api/settings/video',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
    vidMsg.textContent = res.ok ? 'Saved ? (restart app)' : 'Save failed';
    setTimeout(()=>vidMsg.textContent='', 3000);
  };

  // Camera helpers
  async function listCameras(){ 
    try{ 
      const devs=await navigator.mediaDevices.enumerateDevices(); 
      const cams=devs.filter(d=>d.kind==='videoinput'); 
      device.innerHTML=''; 
      cams.forEach((c,i)=>{ 
        const opt=document.createElement('option'); 
        opt.value=c.deviceId; 
        opt.textContent=c.label||`Camera ${i+1}`; 
        device.appendChild(opt); 
      }); 
      const obs=[...device.options].find(o=>/obs|virtual/i.test(o.textContent)); 
      if(obs) device.value=obs.value; 
    } catch{} 
  }

  async function startCamera(deviceId){ 
    stopStream(); 
    const constraints=deviceId?{deviceId:{exact:deviceId}}:true; 
    stream=await navigator.mediaDevices.getUserMedia({video:constraints,audio:false}); 
    await attachStream(stream); 
  }

  async function startScreen(){ 
    stopStream(); 
    try{ 
      stream=await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' } , audio:false }); 
    } catch { return; } 
    await attachStream(stream); 
  }

  async function attachStream(s){ 
    feed.srcObject=s; 
    await feed.play().catch(()=>{}); 
    await new Promise(res=>{ 
      if(feed.videoWidth&&feed.videoHeight) return res(); 
      feed.onloadedmetadata=()=>res(); 
      setTimeout(res,500); 
    }); 
    const w=feed.videoWidth||1280, h=feed.videoHeight||720; 
    const oldW=canvas.width||1280, oldH=canvas.height||720; 
    canvas.width=w; canvas.height=h; 
    feed.width=w; feed.height=h; 
    stage.style.width=w+'px'; stage.style.height=h+'px'; 
    if(quad && !lockRect.checked && (oldW!==w||oldH!==h)){ 
      const sx=w/oldW, sy=h/oldH; 
      quad=quad.map(p=>({x:p.x*sx,y:p.y*sy})); 
    } 
    ensureInitialQuad(); 
    const margin=handleR; 
    quad=quad.map(p=>({ x:clamp(p.x,margin,canvas.width-margin), y:clamp(p.y,margin,canvas.height-margin) })); 
    cancelAnimationFrame(rafId); 
    const tick=()=>{ drawOverlay(); rafId=requestAnimationFrame(tick); }; 
    rafId=requestAnimationFrame(tick); 
  }

  function stopStream(){ 
    if(stream) stream.getTracks().forEach(t=>t.stop()); 
    stream=null; 
  }

  mode.onchange=async()=>{ 
    const m=mode.value; 
    camWrap.hidden=(m!=='camera'); 
    pickBtn.hidden=(m!=='screen'); 
    if (screenHint) screenHint.hidden = (m!=='screen'); 
    if(m==='camera'){ 
      await listCameras(); 
      if(device.value) await startCamera(device.value); 
    } else if(m==='screen'){ 
      /* wait for user click */ 
    } else { 
      stopStream(); 
    } 
  };

  device.onchange=async()=>{ if(mode.value==='camera') await startCamera(device.value); };
  pickBtn.onclick=async()=>{ if(mode.value==='screen') await startScreen(); };

  saveBtn.onclick=async()=>{
    const oq = orderedQuad(quad);
    const quadPayload = oq.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    const body = {
      id: camId.value.trim() || 'scene-1',
      name: camName.value.trim() || 'DeskCam',
      canonical: { width: 1000, height: 2000 },
      quad: quadPayload,
      scene: { width: feed.videoWidth || canvas.width || 1280, height: feed.videoHeight || canvas.height || 720 }
    };
    const res=await fetch('/api/profiles/camera',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    msg.textContent=res.ok?'Saved ?':'Save failed'; 
    setTimeout(()=>msg.textContent='',2000);
  };

  // ============== ROI Editor ==============
  
  const CAN = { width: 1000, height: 2000 };
  let roiBg = null;
  const rois = { leftOutlane:[], centerDrain:[], rightOutlane:[] };

  function drawRois(){ 
    if (!rctx) return;
    rctx.clearRect(0,0,roiCanvas.width,roiCanvas.height); 
    if(roiBg) rctx.drawImage(roiBg,0,0,roiCanvas.width,roiCanvas.height); 
    const colors={ leftOutlane:'rgba(0,200,255,0.35)', centerDrain:'rgba(255,80,80,0.35)', rightOutlane:'rgba(0,255,130,0.35)'}; 
    const strokes={ leftOutlane:'#00c8ff', centerDrain:'#ff5050', rightOutlane:'#00ff82'}; 
    for(const key of Object.keys(rois)){ 
      const pts=rois[key]; 
      if(!pts.length) continue; 
      rctx.beginPath(); 
      rctx.moveTo(pts[0][0],pts[0][1]); 
      for(let i=1;i<pts.length;i++) rctx.lineTo(pts[i][0],pts[i][1]); 
      rctx.closePath(); 
      rctx.fillStyle=colors[key]; 
      rctx.fill(); 
      rctx.lineWidth=2; 
      rctx.strokeStyle=strokes[key]; 
      rctx.stroke(); 
    } 
    const active=roiSelect.value; 
    const pts=rois[active]; 
    rctx.fillStyle='#fff'; 
    rctx.strokeStyle=strokes[active]; 
    for(const p of pts){ 
      rctx.beginPath(); 
      rctx.arc(p[0],p[1],5,0,Math.PI*2); 
      rctx.fill(); 
      rctx.stroke(); 
    } 
  }
  
  function roiHit(mx,my){ 
    const pts=rois[roiSelect.value]; 
    for(let i=0;i<pts.length;i++){ 
      const dx=mx-pts[i][0], dy=my-pts[i][1]; 
      if(dx*dx+dy*dy<=25) return i; 
    } 
    return -1; 
  }

  let roiDrag=-1;
  
  if (roiCanvas) {
    roiCanvas.addEventListener('pointerdown', e=>{ 
      const r=roiCanvas.getBoundingClientRect(); 
      const mx=(e.clientX-r.left)*(roiCanvas.width/r.width); 
      const my=(e.clientY-r.top)*(roiCanvas.height/r.height); 
      const i=roiHit(mx,my); 
      if(i>=0){ roiDrag=i; return; } 
      rois[roiSelect.value].push([Math.round(mx),Math.round(my)]); 
      drawRois(); 
    });
    
    roiCanvas.addEventListener('pointermove', e=>{ 
      if(roiDrag<0) return; 
      const r=roiCanvas.getBoundingClientRect(); 
      const mx=(e.clientX-r.left)*(roiCanvas.width/r.width); 
      const my=(e.clientY-r.top)*(roiCanvas.height/r.height); 
      rois[roiSelect.value][roiDrag]=[ 
        Math.max(0,Math.min(roiCanvas.width,Math.round(mx))), 
        Math.max(0,Math.min(roiCanvas.height,Math.round(my))) 
      ]; 
      drawRois(); 
    });
    
    roiCanvas.addEventListener('pointerup', ()=>roiDrag=-1); 
    roiCanvas.addEventListener('pointerleave', ()=>roiDrag=-1);
    roiCanvas.width=CAN.width; 
    roiCanvas.height=CAN.height; 
  }
  
  document.addEventListener('keydown', e=>{ 
    if(e.key==='Backspace'||e.key==='Delete'){ 
      const arr=rois[roiSelect.value]; 
      if(arr.length>0){ arr.pop(); drawRois(); } 
    } 
  });
  
  if (roiClear) roiClear.onclick=()=>{ rois[roiSelect.value]=[]; drawRois(); };

  if (snapBtn) snapBtn.onclick=async()=>{ 
    if(!feed.videoWidth||!feed.videoHeight||!quad) return; 
    const tmp=document.createElement('canvas'); 
    tmp.width=feed.videoWidth; 
    tmp.height=feed.videoHeight; 
    tmp.getContext('2d').drawImage(feed,0,0); 
    const dataUrl=tmp.toDataURL('image/png'); 
    const oq=orderedQuad(quad); 
    const body={ canonical:{width:CAN.width,height:CAN.height}, quad:oq.map(p=>({x:p.x,y:p.y})), imageBase64:dataUrl }; 
    const res=await fetch('/api/calibrate/warp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); 
    if(!res.ok){ roiMsg.textContent='Warp failed'; setTimeout(()=>roiMsg.textContent='',2000); return; } 
    const blob=await res.blob(); 
    roiBg=await createImageBitmap(blob); 
    drawRois(); 
  };

  if (saveGame) saveGame.onclick=async()=>{ 
    const body={ id:gameId.value.trim()||'generic-pin', name:gameName.value.trim()||'Generic Pin', canonical:{width:CAN.width,height:CAN.height}, rois }; 
    const res=await fetch('/api/profiles/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); 
    roiMsg.textContent=res.ok?'Saved ?':'Save failed'; 
    setTimeout(()=>roiMsg.textContent='',2000); 
  };
  
  if (activate) activate.onclick=async()=>{ 
    const body={ cameraId: (camId?.value||'scene-1'), gameId: gameId.value.trim()||'generic-pin' }; 
    const res=await fetch('/api/profiles/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); 
    roiMsg.textContent=res.ok?'Activated ?':'Activate failed'; 
    setTimeout(()=>roiMsg.textContent='',2000); 
  };

  // ============== Initialization ==============
  
  drawRois();
  
  // Start status monitoring
  setInterval(updateStatus, 2000);

  (async function init(){ 
    await loadVideoSettings(); 
    await listCameras().catch(()=>{}); 
    mode.value='camera'; 
    mode.onchange(); 
    drawOverlay(); 
    updateStatus();
    console.log('PinDrain Dashboard initialized');
  })();
});