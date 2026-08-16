// ============================================================
// Flock.io — Authoritative Multiplayer Server (full feature set)
// Plain Node.js + ws — server decides everything, client only renders it
// ============================================================
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const PORT = process.env.PORT || 3000;
const WORLD = { w: 3000, h: 3000 };
const TICK_MS = 50;                      // 20 ticks/sec
const HUNGER_LIMIT_MS = 5 * 60 * 1000;    // 5 minutes — sheep AND wolves
const BUFF_DURATION_MS = 5 * 60 * 1000;   // energy/turbo/eagle-eye/shield/magnet
const GOLDEN_DURATION_MS = 20 * 1000;     // legendary Golden Apple stays short
const SHADOW_DURATION_MS = 10 * 60 * 1000;
const FOOD_TARGET = 180;
const SHEEP_RATIO = 0.70;

const NAMES = ['Fares','Layla','Omar','Ivy','Noor','Kenji','Diego','Aisha','Milo','Tariq',
               'Sofia','Yusuf','Mei','Karim','Elif','Zane','Rania','Hugo','Amara','Bilal'];
const FLAGS = ['🇯🇴','🇦🇪','🇺🇸','🇷🇺','🇧🇷','🇰🇷','🇪🇬','🇬🇧','🇫🇷','🇮🇳','🇯🇵','🇲🇽','🇹🇷','🇩🇪','🇨🇦'];

const FOOD_TYPES = [
  { key:'grass',   val:2,  weight:30 },
  { key:'apple',   val:4,  weight:12 },
  { key:'corn',    val:4,  weight:9  },
  { key:'noodles', val:8,  weight:8  },
  { key:'momo',    val:8,  weight:8  },
  { key:'sushi',   val:6,  weight:8  },
  { key:'sashimi', val:7,  weight:6  },
  { key:'burger',  val:10, weight:5  },
  { key:'pizza',   val:10, weight:5  },
  { key:'donut',   val:8,  weight:5  },
  { key:'golden',  val:30, weight:2, buff:'golden' },
  { key:'energy',  val:15, weight:3, buff:'energy' },
  { key:'turbo',   val:12, weight:2, buff:'turbo'  },
  { key:'eagleeye',val:10, weight:2, buff:'vision' },
  { key:'shield',  val:10, weight:2, buff:'shield' },
  { key:'magnet',  val:10, weight:2, buff:'magnet' },
];
const TOTAL_WEIGHT = FOOD_TYPES.reduce((a,f) => a + f.weight, 0);
function pickFoodType(){
  let r = Math.random() * TOTAL_WEIGHT;
  for (const f of FOOD_TYPES){ if (r < f.weight) return f; r -= f.weight; }
  return FOOD_TYPES[0];
}

function randomId(){ return Math.random().toString(36).slice(2, 10); }
function speedFor(mass){ return Math.max(1.1, 3.6 - Math.log(mass + 10) * 0.28); }
function radiusFor(mass, isWolf){
  const base = isWolf ? 22 : 14;
  const scale = Math.min(1 + mass / (isWolf ? 4000 : 20000), isWolf ? 3.2 : 2.4);
  return base * scale;
}

// ---------------- game state ----------------
const players = new Map();
const foods = new Map();

function spawnFood(){
  const type = pickFoodType();
  const id = randomId();
  foods.set(id, { id, x: Math.random()*WORLD.w, y: Math.random()*WORLD.h, key: type.key, val: type.val, buff: type.buff || null });
}
for (let i=0;i<FOOD_TARGET;i++) spawnFood();

// ---------------- population balancer ----------------
function assignRole(excludingId){
  let sheepCount = 0, wolfCount = 0;
  for (const p of players.values()){
    if (excludingId && p.id === excludingId) continue;
    if (p.role === 'sheep') sheepCount++; else if (p.role === 'wolf') wolfCount++;
  }
  const total = sheepCount + wolfCount;
  if (total === 0) return 'sheep';
  return (sheepCount/total) < SHEEP_RATIO ? 'sheep' : 'wolf';
}

function freshPlayer(id, ws){
  const role = assignRole(id);
  return {
    id, ws, role,
    name: NAMES[Math.floor(Math.random()*NAMES.length)],
    flag: FLAGS[Math.floor(Math.random()*FLAGS.length)],
    x: Math.random()*WORLD.w, y: Math.random()*WORLD.h,
    mass: role === 'wolf' ? 260 : 20,
    alive: true, dirX: 0, dirY: 0, lastAte: Date.now(),
    boostType: null, boostMult: 1, boostUntil: 0,
    visionUntil: 0, shieldUntil: 0, magnetUntil: 0, shadowUntil: 0,
  };
}

function respawn(p){
  p.role = assignRole(p.id);
  p.mass = p.role === 'wolf' ? 260 : 20;
  p.x = Math.random()*WORLD.w; p.y = Math.random()*WORLD.h;
  p.alive = true; p.lastAte = Date.now();
  p.boostType = null; p.boostMult = 1; p.boostUntil = 0;
  p.visionUntil = 0; p.shieldUntil = 0; p.magnetUntil = 0; p.shadowUntil = 0;
}

// ---------------- game loop ----------------
function tick(){
  const now = Date.now();

  for (const p of players.values()){
    if (!p.alive) continue;
    const mag = Math.hypot(p.dirX, p.dirY) || 1;
    const boostMult = now < p.boostUntil ? p.boostMult : 1;
    const shadowMult = (p.role === 'wolf' && now < p.shadowUntil) ? 1.35 : 1;
    const roleMult = p.role === 'wolf' ? 1.15 : 1;
    const spd = speedFor(p.mass) * boostMult * shadowMult * roleMult;
    p.x = Math.max(0, Math.min(WORLD.w, p.x + (p.dirX/mag)*spd));
    p.y = Math.max(0, Math.min(WORLD.h, p.y + (p.dirY/mag)*spd));
  }

  // magnet — pulls nearby food toward players who have it active
  for (const p of players.values()){
    if (!p.alive || now >= p.magnetUntil) continue;
    for (const f of foods.values()){
      const dx = p.x-f.x, dy = p.y-f.y, d = Math.hypot(dx,dy);
      if (d < 260 && d > 1){
        const pull = Math.min(9, d*0.15);
        f.x += (dx/d)*pull; f.y += (dy/d)*pull;
      }
    }
  }

  // sheep eat food
  for (const p of players.values()){
    if (!p.alive || p.role !== 'sheep') continue;
    for (const f of foods.values()){
      const d = Math.hypot(f.x-p.x, f.y-p.y);
      if (d < radiusFor(p.mass,false) + 8){
        p.mass += f.val;
        p.lastAte = now;
        if (f.buff === 'golden'){ p.boostType='golden'; p.boostMult=1.5; p.boostUntil = now+GOLDEN_DURATION_MS; }
        else if (f.buff === 'energy'){ p.boostType='energy'; p.boostMult=1.6; p.boostUntil = now+BUFF_DURATION_MS; }
        else if (f.buff === 'turbo'){ p.boostType='turbo'; p.boostMult=1.35; p.boostUntil = now+BUFF_DURATION_MS; }
        else if (f.buff === 'vision'){ p.visionUntil = now+BUFF_DURATION_MS; }
        else if (f.buff === 'shield'){ p.shieldUntil = now+BUFF_DURATION_MS; }
        else if (f.buff === 'magnet'){ p.magnetUntil = now+BUFF_DURATION_MS; }
        foods.delete(f.id);
        spawnFood();
      }
    }
  }

  // wolves eat sheep
  const sheepList = [...players.values()].filter(p => p.alive && p.role === 'sheep');
  for (const w of players.values()){
    if (!w.alive || w.role !== 'wolf') continue;
    for (const s of sheepList){
      if (!s.alive) continue;
      const d = Math.hypot(s.x-w.x, s.y-w.y);
      if (d < radiusFor(w.mass,true) + radiusFor(s.mass,false)*0.6){
        if (now < s.shieldUntil){
          // shielded hit: survive, lose mass, get knocked back, shield consumed
          s.shieldUntil = 0;
          s.mass = Math.max(20, s.mass*0.7);
          const away = Math.atan2(s.y-w.y, s.x-w.x);
          s.x = Math.max(0, Math.min(WORLD.w, s.x + Math.cos(away)*90));
          s.y = Math.max(0, Math.min(WORLD.h, s.y + Math.sin(away)*90));
        } else {
          const wasGolden = s.boostType === 'golden' && now < s.boostUntil;
          w.mass += s.mass*0.6;
          w.lastAte = now;
          if (wasGolden) w.shadowUntil = now + SHADOW_DURATION_MS;
          s.alive = false;
          respawn(s);
        }
        break;
      }
    }
  }

  // hunger — everyone, sheep or wolf, dies without eating in 5 minutes
  for (const p of players.values()){
    if (p.alive && now - p.lastAte > HUNGER_LIMIT_MS){
      p.alive = false;
      respawn(p);
    }
  }

  broadcastState(now);
}

function broadcastState(now){
  let kingSheepId = null, kingSheepMass = 0;
  let kingWolfId = null, kingWolfMass = 0;
  for (const p of players.values()){
    if (!p.alive) continue;
    if (p.role === 'sheep' && p.mass > kingSheepMass){ kingSheepMass = p.mass; kingSheepId = p.id; }
    if (p.role === 'wolf' && p.mass > kingWolfMass){ kingWolfMass = p.mass; kingWolfId = p.id; }
  }

  const payload = JSON.stringify({
    type: 'state',
    kingSheepId, kingWolfId,
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name, flag: p.flag, role: p.role,
      x: Math.round(p.x), y: Math.round(p.y),
      mass: Math.round(p.mass), alive: p.alive,
      hungerMs: Math.max(0, HUNGER_LIMIT_MS - (now - p.lastAte)),
      boostType: now < p.boostUntil ? p.boostType : null,
      boostMsLeft: Math.max(0, p.boostUntil - now),
      visionMsLeft: Math.max(0, p.visionUntil - now),
      shieldMsLeft: Math.max(0, p.shieldUntil - now),
      magnetMsLeft: Math.max(0, p.magnetUntil - now),
      shadow: p.role === 'wolf' && now < p.shadowUntil,
    })),
    foods: [...foods.values()].map(f => ({ id: f.id, x: Math.round(f.x), y: Math.round(f.y), key: f.key })),
  });
  for (const p of players.values()){
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(payload);
  }
}

setInterval(tick, TICK_MS);

// ---------------- networking plumbing ----------------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const id = randomId();
  const player = freshPlayer(id, ws);
  players.set(id, player);
  console.log(`Player joined: ${player.name} (${player.role}) — ${players.size} online`);

  ws.send(JSON.stringify({ type:'welcome', id, world: WORLD, hungerLimitMs: HUNGER_LIMIT_MS }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.type === 'input' && typeof msg.dx === 'number' && typeof msg.dy === 'number'){
      player.dirX = msg.dx; player.dirY = msg.dy;
    }
  });

  ws.on('close', () => {
    players.delete(id);
    console.log(`Player left: ${player.name} — ${players.size} online`);
  });
});

server.listen(PORT, () => {
  console.log(`Flock.io server running on http://localhost:${PORT}`);
});
