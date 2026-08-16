// ============================================================
// Flock.io — Authoritative Multiplayer Server (spatial-grid edition)
// Plain Node.js + ws — server decides everything, client only renders it
//
// PERFORMANCE MODEL (important — read this if you tune numbers below):
// - A spatial hash grid (SpatialGrid) buckets players/food by cell so
//   collision + AI checks only look at nearby cells, not the whole world.
//   This is what lets population scale without O(n²) cost.
// - Each connected human only receives players/food within NETWORK_RADIUS
//   of themselves, not the entire map. That keeps the JSON payload (and
//   the client's rendering work) small no matter how many bots exist.
// - Bots recompute their AI decision only once every AI_INTERVAL_TICKS
//   ticks (staggered by aiOffset so they don't all think on the same
//   tick). Movement itself still updates every tick — it's just cheap.
// - BOT_COUNT is tuned for Render's free tier (0.1 CPU / 512MB). Raise
//   it once you're on a paid instance — nothing else needs to change.
// ============================================================
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const PORT = process.env.PORT || 3000;
const WORLD = { w: 6000, h: 6000 };
const TICK_MS = 50;                       // 20 ticks/sec
const HUNGER_LIMIT_MS = 5 * 60 * 1000;    // 5 minutes — sheep AND wolves
const BUFF_DURATION_MS = 5 * 60 * 1000;   // energy/turbo/eagle-eye/shield/magnet
const GOLDEN_DURATION_MS = 20 * 1000;     // legendary Golden Apple stays short
const SHADOW_DURATION_MS = 10 * 60 * 1000;
const FOOD_TARGET = 400;
const SHEEP_RATIO = 0.70;

const BOT_COUNT = 300;                    // fake players that keep the world feeling alive
const GRID_CELL = 220;                    // spatial hash cell size (world units)
const NETWORK_RADIUS = 1800;              // how far each human can "see" over the network
const AI_INTERVAL_TICKS = 6;              // bots re-decide every ~300ms, staggered

const NAMES = ['Fares','Layla','Omar','Ivy','Noor','Kenji','Diego','Aisha','Milo','Tariq',
               'Sofia','Yusuf','Mei','Karim','Elif','Zane','Rania','Hugo','Amara','Bilal',
               'Nadia','Ravi','Lucia','Sam','Priya','Omer','Farah','Leo','Hana','Adam'];
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

// ---------------- spatial hash grid ----------------
// Buckets entities by cell so "who's near X" is a handful of lookups
// instead of scanning every entity in the game.
class SpatialGrid {
  constructor(cellSize){ this.cellSize = cellSize; this.cells = new Map(); }
  _key(cx, cy){ return cx + '_' + cy; }
  clear(){ this.cells.clear(); }
  insert(item, x, y){
    const cx = Math.floor(x / this.cellSize), cy = Math.floor(y / this.cellSize);
    const k = this._key(cx, cy);
    let bucket = this.cells.get(k);
    if (!bucket){ bucket = []; this.cells.set(k, bucket); }
    bucket.push(item);
  }
  near(x, y, radius){
    const out = [];
    const cr = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(x / this.cellSize), cy = Math.floor(y / this.cellSize);
    for (let dx = -cr; dx <= cr; dx++){
      for (let dy = -cr; dy <= cr; dy++){
        const bucket = this.cells.get(this._key(cx + dx, cy + dy));
        if (bucket) for (const it of bucket) out.push(it);
      }
    }
    return out;
  }
}
const foodGrid = new SpatialGrid(GRID_CELL);
const playerGrid = new SpatialGrid(GRID_CELL);
function rebuildGrids(){
  foodGrid.clear();
  for (const f of foods.values()) foodGrid.insert(f, f.x, f.y);
  playerGrid.clear();
  for (const p of players.values()) if (p.alive) playerGrid.insert(p, p.x, p.y);
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

function freshPlayer(id, ws, isBot){
  const role = assignRole(id);
  return {
    id, ws, role, isBot: !!isBot,
    name: NAMES[Math.floor(Math.random()*NAMES.length)],
    flag: FLAGS[Math.floor(Math.random()*FLAGS.length)],
    x: Math.random()*WORLD.w, y: Math.random()*WORLD.h,
    mass: role === 'wolf' ? 260 : 20,
    alive: true, dirX: 0, dirY: 0, lastAte: Date.now(),
    boostType: null, boostMult: 1, boostUntil: 0,
    visionUntil: 0, shieldUntil: 0, magnetUntil: 0, shadowUntil: 0,
    aiOffset: Math.floor(Math.random()*AI_INTERVAL_TICKS),
    wanderDirX: Math.random()*2-1, wanderDirY: Math.random()*2-1,
  };
}

function respawn(p){
  p.role = assignRole(p.id);
  p.mass = p.role === 'wolf' ? 260 : 20;
  p.x = Math.random()*WORLD.w; p.y = Math.random()*WORLD.h;
  p.alive = true; p.lastAte = Date.now();
  p.boostType = null; p.boostMult = 1; p.boostUntil = 0;
  p.visionUntil = 0; p.shieldUntil = 0; p.magnetUntil = 0; p.shadowUntil = 0;
  p.wanderDirX = Math.random()*2-1; p.wanderDirY = Math.random()*2-1;
}

// ---------------- bots ----------------
function spawnBot(){
  const id = 'bot_' + randomId();
  const p = freshPlayer(id, null, true);
  players.set(id, p);
}
for (let i=0;i<BOT_COUNT;i++) spawnBot();

const BORDER_MARGIN = 260; // bots start steering away from the edge this far out (dying at the edge is now instant)
function updateBotAI(p){
  if (p.role === 'sheep'){
    const wolvesNear = playerGrid.near(p.x, p.y, 450).filter(o => o.alive && o.role === 'wolf');
    if (wolvesNear.length){
      let nearest = null, nd = Infinity;
      for (const w of wolvesNear){ const d = Math.hypot(w.x-p.x, w.y-p.y); if (d < nd){ nd = d; nearest = w; } }
      p.wanderDirX = p.x - nearest.x; p.wanderDirY = p.y - nearest.y;
    } else {
      const foodsNear = foodGrid.near(p.x, p.y, 400);
      if (foodsNear.length){
        let nearest = null, nd = Infinity;
        for (const f of foodsNear){ const d = Math.hypot(f.x-p.x, f.y-p.y); if (d < nd){ nd = d; nearest = f; } }
        p.wanderDirX = nearest.x - p.x; p.wanderDirY = nearest.y - p.y;
      } else if (Math.random() < 0.3){
        p.wanderDirX = Math.random()*2-1; p.wanderDirY = Math.random()*2-1;
      }
    }
  } else {
    const sheepNear = playerGrid.near(p.x, p.y, 600).filter(o => o.alive && o.role === 'sheep');
    if (sheepNear.length){
      let nearest = null, nd = Infinity;
      for (const s of sheepNear){ const d = Math.hypot(s.x-p.x, s.y-p.y); if (d < nd){ nd = d; nearest = s; } }
      p.wanderDirX = nearest.x - p.x; p.wanderDirY = nearest.y - p.y;
    } else if (Math.random() < 0.3){
      p.wanderDirX = Math.random()*2-1; p.wanderDirY = Math.random()*2-1;
    }
  }
  // steer back in before the border kills them
  if (p.x < BORDER_MARGIN) p.wanderDirX = Math.abs(p.wanderDirX) + 0.4;
  if (p.x > WORLD.w - BORDER_MARGIN) p.wanderDirX = -Math.abs(p.wanderDirX) - 0.4;
  if (p.y < BORDER_MARGIN) p.wanderDirY = Math.abs(p.wanderDirY) + 0.4;
  if (p.y > WORLD.h - BORDER_MARGIN) p.wanderDirY = -Math.abs(p.wanderDirY) - 0.4;
  p.dirX = p.wanderDirX; p.dirY = p.wanderDirY;
}

// ---------------- leaderboard (cheap top-K, no full sort) ----------------
function topKByMass(k){
  const top = [];
  for (const p of players.values()){
    if (!p.alive) continue;
    if (top.length < k){
      top.push(p); top.sort((a,b) => b.mass - a.mass);
    } else if (p.mass > top[top.length-1].mass){
      top[top.length-1] = p; top.sort((a,b) => b.mass - a.mass);
    }
  }
  return top;
}

// ---------------- game loop ----------------
let tickCount = 0;
function tick(){
  tickCount++;
  const now = Date.now();

  // bot decisions — throttled + staggered so not all 300 think on the same tick
  for (const p of players.values()){
    if (p.isBot && p.alive && (tickCount + p.aiOffset) % AI_INTERVAL_TICKS === 0){
      updateBotAI(p);
    }
  }

  // movement — touching the world edge is now an instant death, same as a wolf catching you
  for (const p of players.values()){
    if (!p.alive) continue;
    const mag = Math.hypot(p.dirX, p.dirY) || 1;
    const boostMult = now < p.boostUntil ? p.boostMult : 1;
    const shadowMult = (p.role === 'wolf' && now < p.shadowUntil) ? 1.35 : 1;
    const roleMult = p.role === 'wolf' ? 1.15 : 1;
    const spd = speedFor(p.mass) * boostMult * shadowMult * roleMult;
    const nx = p.x + (p.dirX/mag)*spd;
    const ny = p.y + (p.dirY/mag)*spd;
    if (nx <= 0 || nx >= WORLD.w || ny <= 0 || ny >= WORLD.h){
      p.alive = false;
      respawn(p);
      continue;
    }
    p.x = nx; p.y = ny;
  }

  // magnet — pulls nearby food toward players who have it active (grid-scoped)
  for (const p of players.values()){
    if (!p.alive || now >= p.magnetUntil) continue;
    const near = foodGrid.near(p.x, p.y, 260);
    for (const f of near){
      const dx = p.x-f.x, dy = p.y-f.y, d = Math.hypot(dx,dy);
      if (d < 260 && d > 1){
        const pull = Math.min(9, d*0.15);
        f.x += (dx/d)*pull; f.y += (dy/d)*pull;
      }
    }
  }

  // sheep eat food — only checks food in nearby cells, not the whole map
  for (const p of players.values()){
    if (!p.alive || p.role !== 'sheep') continue;
    const r = radiusFor(p.mass, false) + 8;
    const near = foodGrid.near(p.x, p.y, r + 40);
    for (const f of near){
      if (!foods.has(f.id)) continue; // already eaten earlier this tick
      const d = Math.hypot(f.x-p.x, f.y-p.y);
      if (d < r){
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

  // wolves eat sheep — only checks sheep in nearby cells, not every sheep in the game
  for (const w of players.values()){
    if (!w.alive || w.role !== 'wolf') continue;
    const near = playerGrid.near(w.x, w.y, radiusFor(w.mass, true) + 80).filter(o => o.alive && o.role === 'sheep');
    for (const s of near){
      const d = Math.hypot(s.x-w.x, s.y-w.y);
      if (d < radiusFor(w.mass,true) + radiusFor(s.mass,false)*0.6){
        if (now < s.shieldUntil){
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

  // rebuild the grid with final positions — used for broadcast now, and for next tick's AI/collisions
  rebuildGrids();

  broadcastState(now);
}

function serializePlayer(p, now){
  return {
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
  };
}
function serializeFood(f){ return { id: f.id, x: Math.round(f.x), y: Math.round(f.y), key: f.key }; }

function broadcastState(now){
  let kingSheepId = null, kingSheepMass = 0;
  let kingWolfId = null, kingWolfMass = 0;
  for (const p of players.values()){
    if (!p.alive) continue;
    if (p.role === 'sheep' && p.mass > kingSheepMass){ kingSheepMass = p.mass; kingSheepId = p.id; }
    if (p.role === 'wolf' && p.mass > kingWolfMass){ kingWolfMass = p.mass; kingWolfId = p.id; }
  }
  const leaderboard = topKByMass(8).map(p => ({
    id: p.id, name: p.name, flag: p.flag, role: p.role, mass: Math.round(p.mass),
  }));

  // each human only gets what's near them — not the whole world — so payload size
  // (and client rendering cost) stays flat no matter how many bots exist
  for (const me of players.values()){
    if (!me.ws || me.ws.readyState !== WebSocket.OPEN) continue;

    const nearPlayers = playerGrid.near(me.x, me.y, NETWORK_RADIUS);
    const nearFoods = foodGrid.near(me.x, me.y, NETWORK_RADIUS);

    const seen = new Set();
    const playersOut = [];
    for (const p of nearPlayers){
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      playersOut.push(serializePlayer(p, now));
    }
    if (!seen.has(me.id)) playersOut.push(serializePlayer(me, now));

    const foodsOut = nearFoods.map(serializeFood);

    const payload = JSON.stringify({
      type: 'state', kingSheepId, kingWolfId, leaderboard,
      players: playersOut, foods: foodsOut,
    });
    me.ws.send(payload);
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
  const player = freshPlayer(id, ws, false);
  players.set(id, player);
  console.log(`Player joined: ${player.name} (${player.role}) — ${players.size} online (incl. bots)`);

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
    console.log(`Player left: ${player.name} — ${players.size} online (incl. bots)`);
  });
});

server.listen(PORT, () => {
  console.log(`Flock.io server running on http://localhost:${PORT}`);
});
