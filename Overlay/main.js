const barL = document.getElementById('barL');
const barC = document.getElementById('barC');
const barR = document.getElementById('barR');
const valL = document.getElementById('valL');
const valC = document.getElementById('valC');
const valR = document.getElementById('valR');
const ticker = document.getElementById('ticker');

let counts = { L: 0, C: 0, R: 0 };
let recentEvents = [];

function render() {
    const total = Math.max(1, counts.L + counts.C + counts.R);
    const pL = Math.round((counts.L * 100) / total);
    const pC = Math.round((counts.C * 100) / total);
    const pR = Math.round((counts.R * 100) / total);

    barL.style.width = pL + '%';
    barC.style.width = pC + '%';
    barR.style.width = pR + '%';

    valL.textContent = `${counts.L} (${pL}%)`;
    valC.textContent = `${counts.C} (${pC}%)`;
    valR.textContent = `${counts.R} (${pR}%)`;
}

function flashLane(lane) {
    const laneElement = document.querySelector(`.lane.${lane.toLowerCase() === 'l' ? 'left' : lane.toLowerCase() === 'c' ? 'center' : 'right'}`);
    if (laneElement) {
        laneElement.classList.add('active');
        setTimeout(() => laneElement.classList.remove('active'), 500);
    }
}

function updateTicker() {
    if (recentEvents.length === 0) {
        ticker.textContent = 'No recent activity';
        return;
    }
    
    const recent = recentEvents.slice(-3).map(e => {
        const laneMap = { L: 'Left', C: 'Center', R: 'Right' };
        const conf = Math.round((e.confidence ?? 1) * 100);
        const source = e.source === 'auto' ? '🤖' : '👤';
        return `${source} ${laneMap[e.lane]} (${conf}%)`;
    }).join(' • ');
    
    ticker.textContent = recent;
}

function applyEvent(ev) {
    // tolerate PascalCase or camelCase from server
    const type = ev.type ?? ev.Type;
    if (type !== 'drain') return;

    const lane = (ev.lane ?? ev.Lane ?? '').toUpperCase();
    if (!['L', 'C', 'R'].includes(lane)) return;

    counts[lane]++;
    
    // Store event for ticker
    recentEvents.push({
        lane,
        confidence: ev.confidence ?? ev.Confidence ?? 1,
        source: ev.source ?? ev.Source ?? 'auto',
        timestamp: Date.now()
    });
    
    // Keep only last 10 events
    if (recentEvents.length > 10) {
        recentEvents = recentEvents.slice(-10);
    }
    
    render();
    flashLane(lane);
    updateTicker();
}

async function bootstrap() {
    // initial stats with key-casing fallback (L/C/R vs l/c/r)
    try {
        const s = await fetch('/api/stats').then(r => r.json());
        const lanes = s.lanes || {};
        counts.L = (lanes.L ?? lanes.l)?.count ?? 0;
        counts.C = (lanes.C ?? lanes.c)?.count ?? 0;
        counts.R = (lanes.R ?? lanes.r)?.count ?? 0;
        render();
        updateTicker();
    } catch (error) {
        console.error('Failed to load initial stats:', error);
    }

    const ws = new WebSocket(`ws://${location.host}/ws`);
    
    ws.onopen = () => {
        ticker.textContent = 'Connected to PinDrain';
        setTimeout(updateTicker, 2000);
    };
    
    ws.onmessage = m => {
        try {
            applyEvent(JSON.parse(m.data));
        } catch (error) {
            console.error('Failed to parse message:', error);
        }
    };
    
    ws.onclose = () => {
        ticker.textContent = 'Connection lost - attempting reconnect...';
        // Attempt to reconnect after 3 seconds
        setTimeout(bootstrap, 3000);
    };
    
    ws.onerror = () => {
        ticker.textContent = 'Connection error';
    };
}

bootstrap();
