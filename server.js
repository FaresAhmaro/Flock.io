// ============================================================
// Flock.io — Authoritative Multiplayer Server
// Plain Node.js + ws (no framework magic, easy to read/debug)
// ============================================================
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const PORT = process.env.PORT || 3000;
const WORLD = { w: 3000, h: 3000 };
const TICK_MS = 50;                 // 20 ticks/sec
const HUNGER_LIMIT_MS = 5 * 60 * 1000; // 5 minutes — applies to sheep AND wolves
const FOOD_TARGET = 150;
const SHEEP_RATIO = 0.70;           // population balancer target

const NAMES = ['Fares','Layla','Omar','Ivy','Noor','Kenji','Diego','Aisha','Milo','Tariq',
               'Sofia','Yusuf','Mei','Karim','Elif','Zane','Rania','Hugo','Amara','Bilal'];
const FLAGS = ['🇯🇴','🇦🇪','🇺🇸','🇷🇺','🇧🇷','🇰🇷','🇪🇬','🇬🇧','🇫🇷','🇮🇳','🇯🇵','🇲🇽','🇹🇷','🇩🇪','🇨🇦'];

function randomId(){ return Math.random().toString(36).slice(2, 10); }
function speedFor(mass){ return Math.max(1.1, 3.6 - Math.log(mass + 10) * 0.28); }
function radiusFor(mass, isWolf){
  const base = isWolf ? 22 : 14;
  const scale = Math.min(1 + mass / (isWolf ? 4000 : 20000), isWolf ? 3.2 : 2.4);
  return base * scale;
}

// ---------------- game state (server-owned, source of truth) ----------------
const players = new Map(); // id -> player object (includes the ws connection)
const foods = new Map();   // id -> {id,x,y,val}

function spawnFood(){
  const id = randomId();
  foods.set(id, {
    id,
    x: Math.random() * WORLD.w,
    y: Math.random() * WORLD.h,
    val: 2 + Math.floor(Math.random() * 8),
  });
}
for (let i = 0; i < FOOD_TARGET; i++) spawnFood();

// ---------------- population balancer ----------------
// Decides sheep vs wolf on join/respawn so the server stays ~70% sheep / 30% wolves,
// regardless of what any individual player would prefer. This is the anti-"cheese" rule:
// a player never chooses their role — the server does, based on current population.
function assignRole(excludingId){
  let sheepCount = 0, wolfCount = 0;
  for (const p of players.values()){
    if (excludingId && p.id === excludingId) continue;
    if (p.role === 'sheep') sheepCount++; else if (p.role === 'wolf') wolfCount++;
  }
  const total = sheepCount + wolfCount;
  if (total === 0) return 'sheep';
  return (sheepCount / total) < SHEEP_RATIO ? 'sheep' : 'wolf';
}

function spawnPlayer(id, ws){
  const role = assignRole(id);
  return {
    id, ws,
    name: NAMES[Math.floor(Math.random() * NAMES.length)],
    flag: FLAGS[Math.floor(Math.random() * FLAGS.length)],
    role,
    x: Math.random() * WORLD.w,
    y: Math.random() * WORLD.h,
    mass: role === 'wolf' ? 260 : 20,
    alive: true,
    dirX: 0, dirY: 0,
    lastAte: Date.now(),
  };
}

function respawn(player){
  const died = player.role;
  player.role = assignRole(player.id); // rebalance on every death/respawn
  player.mass = player.role === 'wolf' ? 260 : 20;
  player.x = Math.random() * WORLD.w;
  player.y = Math.random() * WORLD.h;
  player.alive = true;
  player.lastAte = Date.now();
  return died;
}

// ---------------- game loop (this is the whole point: server decides everything) ----------------
function tick(){
  const now = Date.now();

  // move players based on their last reported input direction
  for (const p of players.values()){
    if (!p.alive) continue;
    const mag = Math.hypot(p.dirX, p.dirY) || 1;
    const spd = speedFor(p.mass) * (p.role === 'wolf' ? 1.15 : 1);
    p.x = Math.max(0, Math.min(WORLD.w, p.x + (p.dirX / mag) * spd));
    p.y = Math.max(0, Math.min(WORLD.h, p.y + (p.dirY / mag) * spd));
  }

  // sheep eat food (wolves don't eat food — only sheep)
  for (const p of players.values()){
    if (!p.alive || p.role !== 'sheep') continue;
    for (const f of foods.values()){
      const d = Math.hypot(f.x - p.x, f.y - p.y);
      if (d < radiusFor(p.mass, false) + 6){
        p.mass += f.val;
        p.lastAte = now;
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
      const d = Math.hypot(s.x - w.x, s.y - w.y);
      if (d < radiusFor(w.mass, true) + radiusFor(s.mass, false) * 0.6){
        w.mass += s.mass * 0.6;
        w.lastAte = now;
        s.alive = false;
        respawn(s);
        break;
      }
    }
  }

  // hunger — everyone dies without eating in 5 minutes, sheep or wolf
  for (const p of players.values()){
    if (p.alive && now - p.lastAte > HUNGER_LIMIT_MS){
      p.alive = false;
      respawn(p);
    }
  }

  broadcastState(now);
}

function broadcastState(now){
  const payload = JSON.stringify({
    type: 'state',
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name, flag: p.flag, role: p.role,
      x: Math.round(p.x), y: Math.round(p.y),
      mass: Math.round(p.mass), alive: p.alive,
      hungerMs: Math.max(0, HUNGER_LIMIT_MS - (now - p.lastAte)),
    })),
    foods: [...foods.values()].map(f => ({ id: f.id, x: Math.round(f.x), y: Math.round(f.y) })),
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
  const player = spawnPlayer(id, ws);
  players.set(id, player);
  console.log(`Player joined: ${player.name} (${player.role}) — ${players.size} online`);

  ws.send(JSON.stringify({
    type: 'welcome',
    id,
    world: WORLD,
    hungerLimitMs: HUNGER_LIMIT_MS,
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.type === 'input' && typeof msg.dx === 'number' && typeof msg.dy === 'number'){
      player.dirX = msg.dx;
      player.dirY = msg.dy;
    }
  });

  ws.on('close', () => {
    players.delete(id);
    console.log(`Player left: ${player.name} — ${players.size} online`);
  });
});

server.listen(PORT, () => {
  console.log(`Flock.io server running on http://localhost:${PORT}`);
  console.log(`Open that URL in two different browser tabs to see two real connected players.`);
});
