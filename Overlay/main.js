const barL = document.getElementById('barL');
const barC = document.getElementById('barC');
const barR = document.getElementById('barR');
const valL = document.getElementById('valL');
const valC = document.getElementById('valC');
const valR = document.getElementById('valR');
const ticker = document.getElementById('ticker');

let counts = { L: 0, C: 0, R: 0 };

function render() {
    const total = Math.max(1, counts.L + counts.C + counts.R);
    const pL = Math.round((counts.L * 100) / total);
    const pC = Math.round((counts.C * 100) / total);
    const pR = Math.round((counts.R * 100) / total);

    barL.style.width = pL + '%';
    barC.style.width = pC + '%';
    barR.style.width = pR + '%';

    // simple colors; theme as you like
    barL.style.background = 'rgba(0,200,255,.9)';
    barC.style.background = 'rgba(255,80,80,.9)';
    barR.style.background = 'rgba(0,255,130,.9)';

    valL.textContent = `${counts.L} (${pL}%)`;
    valC.textContent = `${counts.C} (${pC}%)`;
    valR.textContent = `${counts.R} (${pR}%)`;
}

function applyEvent(ev) {
    // tolerate PascalCase or camelCase from server
    const type = ev.type ?? ev.Type;
    if (type !== 'drain') return;

    const lane = (ev.lane ?? ev.Lane ?? '').toUpperCase();
    if (!['L', 'C', 'R'].includes(lane)) return;

    counts[lane]++;
    render();

    const conf = ev.confidence ?? ev.Confidence ?? 1;
    ticker.textContent = `Drain: ${lane} • conf ${Math.round(conf * 100)}%`;
    setTimeout(() => (ticker.textContent = ''), 2000);
}

async function bootstrap() {
    // initial stats with key-casing fallback (L/C/R vs l/c/r)
    const s = await fetch('/api/stats').then(r => r.json());
    const lanes = s.lanes || {};
    counts.L = (lanes.L ?? lanes.l)?.count ?? 0;
    counts.C = (lanes.C ?? lanes.c)?.count ?? 0;
    counts.R = (lanes.R ?? lanes.r)?.count ?? 0;
    render();

    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = m => {
        try {
            applyEvent(JSON.parse(m.data));
        } catch {
            /* ignore */
        }
    };
    ws.onclose = () => {
        ticker.textContent = 'WS disconnected';
    };
}

bootstrap();
