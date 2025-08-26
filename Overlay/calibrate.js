// Simple calibration tool drawing a draggable quad over a background image or video frame.
// For now, we use an <img> snapshot URL placeholder. Replace with your stream snapshot if available.

const canvas = document.getElementById('calCanvas');
const ctx = canvas.getContext('2d');
const saveBtn = document.getElementById('saveBtn');
const camName = document.getElementById('camName');
const statusEl = document.getElementById('status');

// Initial quad (normalized to canvas size). TL, TR, BR, BL
let quad = [
  [200, 80],
  [1080, 90],
  [1180, 680],
  [100, 700]
];

const handleR = 8;
let dragging = -1;

const bg = new Image();
// If you have a stream snapshot endpoint, point to it; else use a placeholder grid.
bg.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse">
      <rect width="40" height="40" fill="#0b0b0b"/>
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#202020"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="20" y="40" fill="#555" font-size="24">PinDrain Calibration - replace with stream snapshot</text>
</svg>`);

bg.onload = () => draw();

function draw() {
  ctx.clearRect(0,0,canvas.width, canvas.height);
  ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);

  // polygon fill
  ctx.beginPath();
  ctx.moveTo(quad[0][0], quad[0][1]);
  for (let i=1;i<quad.length;i++) ctx.lineTo(quad[i][0], quad[i][1]);
  ctx.closePath();
  ctx.fillStyle = 'rgba(30,136,229,0.15)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#1e88e5';
  ctx.stroke();

  // handles
  for (let i=0;i<quad.length;i++) {
    const [x,y] = quad[i];
    ctx.beginPath();
    ctx.arc(x,y,handleR,0,Math.PI*2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#1e88e5';
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.fillText(['TL','TR','BR','BL'][i], x+10, y-10);
  }
}

function hitHandle(mx, my) {
  for (let i=0;i<quad.length;i++) {
    const [x,y] = quad[i];
    const dx = mx - x, dy = my - y;
    if (dx*dx + dy*dy <= handleR*handleR*2) return i;
  }
  return -1;
}

canvas.addEventListener('pointerdown', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);
  dragging = hitHandle(mx,my);
});

canvas.addEventListener('pointermove', e => {
  if (dragging < 0) return;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);
  quad[dragging] = [Math.max(0, Math.min(canvas.width, mx)), Math.max(0, Math.min(canvas.height, my))];
  draw();
});

canvas.addEventListener('pointerup', () => dragging = -1);
canvas.addEventListener('pointerleave', () => dragging = -1);

saveBtn.addEventListener('click', async () => {
  const id = (camName.value || 'default').trim();
  if (!id) { alert('Enter a camera name'); return; }
  const payload = { id, name: id, quad };
  try {
    await fetch('/api/profiles/camera', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    statusEl.textContent = 'Saved camera profile.';
    setTimeout(()=> statusEl.textContent = '', 2000);
  } catch (e) {
    statusEl.textContent = 'Error saving profile';
  }
});

draw();
