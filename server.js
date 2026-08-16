// server.js — Authoritative multiplayer worm-io game server
// Features: bots, emoji foods, power-ups (speed/invincible/radar/gold),
// head-to-head + body collisions, accounts w/ persisted score & gold,
// cosmetics (skins + accessories), spatial-grid optimizations.

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================= CONFIG =================
const WORLD_SIZE = 6000;
const FOOD_COUNT = 1400;
const TICK_RATE = 33;
const BASE_SPEED = 3.2;
const BOOST_SPEED = 6.0;
const SPEED_FOOD_SPEED = 4.6;
const TURN_RATE = 0.14;
const START_LENGTH = 12;
const SEGMENT_SPACING = 8;
const FOOD_RADIUS = 6;
const EAT_DISTANCE = 18;
const BOOST_COST_TICKS = 6;
const BOT_COUNT = 45;
const VIEW_RADIUS = 1700;               // how far each client sees (for network optimization)
const GRID_CELL = 220;

const SPEED_DURATION = 8000;            // ms
const RADAR_DURATION = 15000;           // ms
const INVINCIBLE_DURATION = 5 * 60 * 1000; // 5 minutes, as requested

// ================ COSMETICS ================
const SKINS = {
  classic:  { colors: ['#5ecbff'] },
  lava:     { colors: ['#ff5e5e'] },
  toxic:    { colors: ['#5eff8f'] },
  royal:    { colors: ['#c95eff'] },
  sunset:   { colors: ['#ff9d5e'] },
  gold:     { colors: ['#ffd700'] },
  flagUSA:  { colors: ['#3c3b6e', '#fff', '#b22234'] },
  flagJPN:  { colors: ['#fff', '#bc002d'] },
  flagGER:  { colors: ['#222', '#d00', '#ffce00'] },
  rainbow:  { colors: ['#ff5e5e', '#ffe65e', '#5eff8f', '#5ecbff', '#c95eff'] }
};
const ACCESSORIES = {
  none: '', shades: '😎', crown: '👑', tophat: '🎩',
  hero: '🦸', bunny: '🐰', ghost: '👻', party: '🥳', halo: '😇'
};

const NORMAL_EMOJIS = ['🍣', '🍔', '🍕', '🍩', '🍎', '🍒', '🍇', '🌭', '🍪', '🍉'];
const BOT_NAMES = ['Slither', 'Noodle', 'Wormy', 'Zigzag', 'Speedy', 'Chomper', 'Tiny', 'Goliath',
  'Blaze', 'Shadow', 'Nibbler', 'Turbo', 'Venom', 'Rex', 'Pixel', 'Rogue', 'Fang', 'Sushi Hunter',
  'Burger King', 'Pizza Lord', 'Sneaky', 'Rocket', 'Frost', 'Ember', 'Storm', 'Ninja Worm'];

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ================ SPATIAL GRID (for scaling) ================
class SpatialGrid {
  constructor(cellSize) { this.cellSize = cellSize; this.cells = new Map(); }
  key(x, y) { return (Math.floor(x / this.cellSize)) + '_' + (Math.floor(y / this.cellSize)); }
  clear() { this.cells.clear(); }
  insert(item, x, y) {
    const k = this.key(x, y);
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k).push(item);
  }
  queryRadius(x, y, radius) {
    const result = [];
    const cr = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(x / this.cellSize), cy = Math.floor(y / this.cellSize);
    for (let dx = -cr; dx <= cr; dx++) {
      for (let dy = -cr; dy <= cr; dy++) {
        const arr = this.cells.get((cx + dx) + '_' + (cy + dy));
        if (arr) result.push(...arr);
      }
    }
    return result;
  }
}
const foodGrid = new SpatialGrid(GRID_CELL);
const segGrid = new SpatialGrid(GRID_CELL);

// ================ STATE ================
const players = {};   // id -> player
const sessions = new Map(); // token -> username
let food = [];
let foodIdCounter = 0;

function weightedFoodKind() {
  const r = Math.random();
  if (r < 0.90) return 'normal';
  if (r < 0.95) return 'speed';
  if (r < 0.98) return 'invincible';
  if (r < 0.995) return 'radar';
  return 'gold';
}
function makeFood(x, y, forcedKind) {
  const kind = forcedKind || weightedFoodKind();
  let emoji, value = 1, color = '#fff';
  switch (kind) {
    case 'speed': emoji = '⚡'; color = '#ffe65e'; break;
    case 'invincible': emoji = '🛡️'; color = '#5ecbff'; break;
    case 'radar': emoji = '📡'; color = '#c95eff'; break;
    case 'gold': emoji = '💰'; color = '#ffd700'; value = Math.floor(rand(10, 50)); break;
    default: emoji = pick(NORMAL_EMOJIS); color = '#ff9d5e'; value = 1;
  }
  return { id: foodIdCounter++, x, y, r: FOOD_RADIUS, kind, emoji, color, value };
}
function spawnFood(count) {
  for (let i = 0; i < count; i++) {
    food.push(makeFood(rand(0, WORLD_SIZE), rand(0, WORLD_SIZE)));
  }
}
spawnFood(FOOD_COUNT);

function resolveSkin(skinId) { return SKINS[skinId] ? skinId : 'classic'; }
function resolveAccessory(accId) { return ACCESSORIES.hasOwnProperty(accId) ? accId : 'none'; }

function spawnPlayer(opts) {
  const x = rand(WORLD_SIZE * 0.2, WORLD_SIZE * 0.8);
  const y = rand(WORLD_SIZE * 0.2, WORLD_SIZE * 0.8);
  const angle = rand(0, Math.PI * 2);
  const segments = [];
  for (let i = 0; i < START_LENGTH; i++) {
    segments.push({ x: x - Math.cos(angle) * i * SEGMENT_SPACING, y: y - Math.sin(angle) * i * SEGMENT_SPACING });
  }
  return {
    name: (opts.name && opts.name.trim()) ? opts.name.trim().slice(0, 16) : 'Worm',
    username: opts.username || null,
    isBot: !!opts.isBot,
    skin: resolveSkin(opts.skin),
    accessory: resolveAccessory(opts.accessory),
    angle, targetAngle: angle,
    speed: BASE_SPEED,
    boosting: false,
    boostTick: 0,
    segments,
    alive: true,
    score: START_LENGTH,
    goldCollected: 0,
    speedUntil: 0,
    invincibleUntil: 0,
    radarUntil: 0,
    aiChangeAt: 0
  };
}

function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

function dropAllFood(p) {
  for (let i = 0; i < p.segments.length; i++) {
    if (i % 2 !== 0 && Math.random() > 0.5) continue; // slight thinning so it's not overwhelming
    const s = p.segments[i];
    food.push(makeFood(s.x, s.y, 'normal'));
  }
}

function persistOnDeath(p) {
  if (!p.username) return;
  const user = db.getUser(p.username);
  if (!user) return;
  const newHigh = Math.max(user.highScore || 0, p.score);
  const newGold = (user.gold || 0) + (p.goldCollected || 0);
  db.updateUser(p.username, { highScore: newHigh, gold: newGold });
}

function killPlayer(id) {
  const p = players[id];
  if (!p || !p.alive) return;
  p.alive = false;
  dropAllFood(p);
  persistOnDeath(p);
  if (!p.isBot) io.to(id).emit('dead', { score: p.score, gold: p.goldCollected });
}

// respawn bots automatically after a short delay
function maybeRespawnBot(id) {
  setTimeout(() => {
    if (players[id] && !players[id].alive) {
      players[id] = spawnPlayer({ name: pick(BOT_NAMES) + ' ' + Math.floor(rand(1, 99)), isBot: true, skin: pick(Object.keys(SKINS)), accessory: pick(Object.keys(ACCESSORIES)) });
    }
  }, rand(2000, 6000));
}

// spawn initial bots
for (let i = 0; i < BOT_COUNT; i++) {
  players['bot-' + i] = spawnPlayer({
    name: pick(BOT_NAMES) + ' ' + Math.floor(rand(1, 99)),
    isBot: true,
    skin: pick(Object.keys(SKINS)),
    accessory: pick(Object.keys(ACCESSORIES))
  });
}

// ================ AUTH ROUTES ================
function makeToken() { return crypto.randomBytes(24).toString('hex'); }

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Username (3+) and password (4+) required.' });
  }
  if (db.getUser(username)) return res.status(400).json({ error: 'Username already taken.' });
  const hash = await bcrypt.hash(password, 10);
  db.createUser({ username, passwordHash: hash, highScore: 0, gold: 0, skin: 'classic', accessory: 'none' });
  const token = makeToken();
  sessions.set(token, username.toLowerCase());
  res.json({ token, username, highScore: 0, gold: 0, skin: 'classic', accessory: 'none' });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = db.getUser(username || '');
  if (!user) return res.status(400).json({ error: 'Invalid username or password.' });
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid username or password.' });
  const token = makeToken();
  sessions.set(token, user.username.toLowerCase());
  res.json({ token, username: user.username, highScore: user.highScore || 0, gold: user.gold || 0, skin: user.skin || 'classic', accessory: user.accessory || 'none' });
});

app.get('/api/me', (req, res) => {
  const token = req.headers['x-auth-token'];
  const username = sessions.get(token);
  if (!username) return res.status(401).json({ error: 'Not logged in' });
  const user = db.getUser(username);
  res.json({ username: user.username, highScore: user.highScore || 0, gold: user.gold || 0, skin: user.skin || 'classic', accessory: user.accessory || 'none' });
});

app.get('/api/cosmetics', (req, res) => { res.json({ skins: SKINS, accessories: ACCESSORIES }); });

// ================ SOCKETS ================
io.on('connection', (socket) => {
  socket.on('join', (data) => {
    data = data || {};
    let username = null;
    if (data.token && sessions.has(data.token)) username = sessions.get(data.token);
    players[socket.id] = spawnPlayer({
      name: data.name, username, skin: data.skin, accessory: data.accessory
    });
  });

  socket.on('input', (data) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    if (typeof data.angle === 'number' && !isNaN(data.angle)) p.targetAngle = data.angle;
    p.boosting = !!data.boosting;
  });

  socket.on('respawn', (data) => {
    data = data || {};
    const prev = players[socket.id];
    const username = prev ? prev.username : null;
    players[socket.id] = spawnPlayer({ name: data.name, username, skin: data.skin, accessory: data.accessory });
  });

  socket.on('updateCosmetics', (data) => {
    const p = players[socket.id];
    if (p) {
      if (data.skin) p.skin = resolveSkin(data.skin);
      if (data.accessory) p.accessory = resolveAccessory(data.accessory);
    }
    if (p && p.username) db.updateUser(p.username, { skin: p.skin, accessory: p.accessory });
  });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p && p.alive) persistOnDeath(p);
    delete players[socket.id];
  });
});

// ================ GAME LOOP ================
function updateBotAI(p) {
  const now = Date.now();
  const head = p.segments[0];

  // steer toward nearest food occasionally, else wander
  if (now > p.aiChangeAt) {
    p.aiChangeAt = now + rand(600, 1400);
    const nearby = foodGrid.queryRadius(head.x, head.y, 500);
    let best = null, bestD = Infinity;
    for (const f of nearby) {
      const d = dist2(head.x, head.y, f.x, f.y);
      if (d < bestD) { bestD = d; best = f; }
    }
    if (best) {
      p.targetAngle = Math.atan2(best.y - head.y, best.x - head.x);
    } else {
      p.targetAngle = p.angle + rand(-1, 1);
    }
    p.boosting = Math.random() < 0.05;
  }

  // steer away from the edges
  const margin = 400;
  if (head.x < margin) p.targetAngle = 0;
  else if (head.x > WORLD_SIZE - margin) p.targetAngle = Math.PI;
  if (head.y < margin) p.targetAngle = Math.PI / 2;
  else if (head.y > WORLD_SIZE - margin) p.targetAngle = -Math.PI / 2;
}

function tick() {
  const now = Date.now();
  const ids = Object.keys(players);

  // rebuild food grid
  foodGrid.clear();
  for (const f of food) foodGrid.insert(f, f.x, f.y);

  // ---- movement ----
  for (const id of ids) {
    const p = players[id];
    if (!p.alive) continue;
    if (p.isBot) updateBotAI(p);

    let diff = p.targetAngle - p.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    diff = Math.max(-TURN_RATE, Math.min(TURN_RATE, diff));
    p.angle += diff;

    let speed = BASE_SPEED;
    if (p.speedUntil > now) speed = SPEED_FOOD_SPEED;
    if (p.boosting && p.segments.length > START_LENGTH) {
      speed = BOOST_SPEED;
      p.boostTick++;
      if (p.boostTick >= BOOST_COST_TICKS) {
        p.boostTick = 0;
        const tail = p.segments.pop();
        p.score = Math.max(START_LENGTH, p.score - 1);
        food.push(makeFood(tail.x, tail.y, 'normal'));
      }
    } else {
      p.boostTick = 0;
    }
    p.speed = speed;

    const head = p.segments[0];
    const nx = head.x + Math.cos(p.angle) * p.speed;
    const ny = head.y + Math.sin(p.angle) * p.speed;

    if (nx < 0 || nx > WORLD_SIZE || ny < 0 || ny > WORLD_SIZE) {
      if (p.invincibleUntil > now) {
        // bounce back inward instead of dying
        p.angle += Math.PI;
        continue;
      }
      killPlayer(id);
      if (p.isBot) maybeRespawnBot(id);
      continue;
    }

    p.segments.unshift({ x: nx, y: ny });
    p.segments.pop();

    // eat food
    const nearFood = foodGrid.queryRadius(nx, ny, EAT_DISTANCE + 20);
    for (const f of nearFood) {
      if (dist2(nx, ny, f.x, f.y) < EAT_DISTANCE * EAT_DISTANCE) {
        const idx = food.indexOf(f);
        if (idx === -1) continue;
        food.splice(idx, 1);

        let growth = 1;
        switch (f.kind) {
          case 'speed': p.speedUntil = now + SPEED_DURATION; break;
          case 'invincible': p.invincibleUntil = now + INVINCIBLE_DURATION; break;
          case 'radar': p.radarUntil = now + RADAR_DURATION; break;
          case 'gold': p.goldCollected += f.value; growth = 3; break;
          default: growth = 1;
        }
        p.score += (f.kind === 'gold' ? 5 : 1);
        for (let g = 0; g < growth; g++) {
          const tail = p.segments[p.segments.length - 1];
          p.segments.push({ x: tail.x, y: tail.y });
        }
      }
    }
  }

  if (food.length < FOOD_COUNT) spawnFood(Math.min(30, FOOD_COUNT - food.length));

  // ---- rebuild segment grid for collisions ----
  segGrid.clear();
  for (const id of ids) {
    const p = players[id];
    if (!p.alive) continue;
    for (let i = 6; i < p.segments.length; i++) { // skip near-head own segments
      const s = p.segments[i];
      segGrid.insert({ ownerId: id, x: s.x, y: s.y }, s.x, s.y);
    }
  }

  // ---- body collisions ----
  for (const id of ids) {
    const p = players[id];
    if (!p.alive || p.invincibleUntil > now) continue;
    const head = p.segments[0];
    const nearby = segGrid.queryRadius(head.x, head.y, EAT_DISTANCE + 10);
    for (const s of nearby) {
      if (s.ownerId === id) continue;
      const other = players[s.ownerId];
      if (!other || !other.alive || other.invincibleUntil > now) continue;
      if (dist2(head.x, head.y, s.x, s.y) < (EAT_DISTANCE * 0.75) * (EAT_DISTANCE * 0.75)) {
        killPlayer(id);
        if (p.isBot) maybeRespawnBot(id);
        break;
      }
    }
  }

  // ---- head-to-head collisions (mutual death) ----
  const aliveIds = ids.filter(id => players[id].alive);
  for (let i = 0; i < aliveIds.length; i++) {
    for (let j = i + 1; j < aliveIds.length; j++) {
      const a = players[aliveIds[i]], b = players[aliveIds[j]];
      if (!a.alive || !b.alive) continue;
      if (a.invincibleUntil > now || b.invincibleUntil > now) continue;
      const ha = a.segments[0], hb = b.segments[0];
      if (dist2(ha.x, ha.y, hb.x, hb.y) < (EAT_DISTANCE * 0.9) * (EAT_DISTANCE * 0.9)) {
        killPlayer(aliveIds[i]);
        killPlayer(aliveIds[j]);
        if (a.isBot) maybeRespawnBot(aliveIds[i]);
        if (b.isBot) maybeRespawnBot(aliveIds[j]);
      }
    }
  }

  broadcastState(now);
}

function broadcastState(now) {
  const ids = Object.keys(players);
  const leaderboard = ids
    .filter(id => players[id].alive)
    .map(id => ({ name: players[id].name, score: players[id].score, isBot: players[id].isBot }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  for (const id of ids) {
    const me = players[id];
    if (me.isBot) continue; // bots don't need state pushed to them
    if (!me || !me.alive) {
      io.to(id).emit('state', { you: null, worms: [], food: [], leaderboard, worldSize: WORLD_SIZE });
      continue;
    }
    const head = me.segments[0];

    // only send nearby worms + food (scales much better with many entities)
    const nearWorms = [];
    for (const oid of ids) {
      const o = players[oid];
      if (!o.alive) continue;
      const oh = o.segments[0];
      if (dist2(head.x, head.y, oh.x, oh.y) < (VIEW_RADIUS + 400) * (VIEW_RADIUS + 400)) {
        nearWorms.push({
          name: o.name, skin: o.skin, colors: SKINS[o.skin].colors, accessory: ACCESSORIES[o.accessory],
          segments: o.segments, score: o.score,
          invincible: o.invincibleUntil > now, boosting: o.boosting
        });
      }
    }
    const nearFood = foodGrid.queryRadius(head.x, head.y, VIEW_RADIUS);

    let radarTargets = [];
    if (me.radarUntil > now) {
      radarTargets = ids
        .filter(oid => oid !== id && players[oid].alive)
        .map(oid => players[oid].segments[0])
        .sort((a, b) => dist2(head.x, head.y, a.x, a.y) - dist2(head.x, head.y, b.x, b.y))
        .slice(0, 5);
    }

    io.to(id).emit('state', {
      you: {
        x: head.x, y: head.y, score: me.score, gold: me.goldCollected, angle: me.angle,
        speedActive: me.speedUntil > now, invincibleActive: me.invincibleUntil > now,
        invincibleMsLeft: Math.max(0, me.invincibleUntil - now),
        radarActive: me.radarUntil > now
      },
      worms: nearWorms,
      food: nearFood,
      leaderboard,
      radarTargets,
      worldSize: WORLD_SIZE
    });
  }
}

setInterval(tick, TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Worm game server running on port ' + PORT));
