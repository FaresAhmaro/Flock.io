// server.js — Authoritative multiplayer worm-io game server
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- CONFIG ----------
const WORLD_SIZE = 4000;          // world is WORLD_SIZE x WORLD_SIZE
const FOOD_COUNT = 800;           // ambient food orbs kept on the map
const TICK_RATE = 33;             // ms per tick (~30fps)
const BASE_SPEED = 3.2;
const BOOST_SPEED = 6.0;
const TURN_RATE = 0.14;           // max radians per tick
const START_LENGTH = 12;          // starting number of segments
const SEGMENT_SPACING = 8;        // distance between segments
const FOOD_RADIUS = 5;
const EAT_DISTANCE = 16;
const BOOST_COST_TICKS = 6;       // lose 1 segment every N ticks while boosting

// ---------- STATE ----------
const players = {};   // socket.id -> player object
const food = [];      // {id, x, y, r, color}
let foodIdCounter = 0;

function rand(min, max) { return Math.random() * (max - min) + min; }
function randomColor() {
  const colors = ['#ff5e5e', '#5ecbff', '#5eff8f', '#ffe65e', '#c95eff', '#ff9d5e', '#5effe6', '#ff5ec4'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function spawnFood(count) {
  for (let i = 0; i < count; i++) {
    food.push({
      id: foodIdCounter++,
      x: rand(0, WORLD_SIZE),
      y: rand(0, WORLD_SIZE),
      r: FOOD_RADIUS,
      color: randomColor()
    });
  }
}
spawnFood(FOOD_COUNT);

function spawnPlayer(name) {
  const x = rand(WORLD_SIZE * 0.2, WORLD_SIZE * 0.8);
  const y = rand(WORLD_SIZE * 0.2, WORLD_SIZE * 0.8);
  const angle = rand(0, Math.PI * 2);
  const segments = [];
  for (let i = 0; i < START_LENGTH; i++) {
    segments.push({ x: x - Math.cos(angle) * i * SEGMENT_SPACING, y: y - Math.sin(angle) * i * SEGMENT_SPACING });
  }
  return {
    name: name && name.trim() ? name.trim().slice(0, 16) : 'Worm',
    color: randomColor(),
    angle,
    targetAngle: angle,
    speed: BASE_SPEED,
    boosting: false,
    boostTick: 0,
    segments,
    alive: true,
    score: START_LENGTH
  };
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

function killPlayer(id) {
  const p = players[id];
  if (!p || !p.alive) return;
  p.alive = false;
  // turn every other body segment into food
  for (let i = 0; i < p.segments.length; i += 2) {
    const s = p.segments[i];
    food.push({ id: foodIdCounter++, x: s.x, y: s.y, r: FOOD_RADIUS + 2, color: p.color });
  }
  io.to(id).emit('dead', { score: p.score });
}

// ---------- SOCKET HANDLING ----------
io.on('connection', (socket) => {
  socket.on('join', (data) => {
    players[socket.id] = spawnPlayer(data && data.name);
  });

  socket.on('input', (data) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    if (typeof data.angle === 'number' && !isNaN(data.angle)) {
      p.targetAngle = data.angle;
    }
    p.boosting = !!data.boosting;
  });

  socket.on('respawn', (data) => {
    players[socket.id] = spawnPlayer(data && data.name);
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
  });
});

// ---------- GAME LOOP ----------
function tick() {
  const ids = Object.keys(players);

  for (const id of ids) {
    const p = players[id];
    if (!p.alive) continue;

    // turn head gradually toward targetAngle (shortest direction)
    let diff = p.targetAngle - p.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    diff = Math.max(-TURN_RATE, Math.min(TURN_RATE, diff));
    p.angle += diff;

    // boosting shrinks the worm slowly, speeds it up
    if (p.boosting && p.segments.length > START_LENGTH) {
      p.speed = BOOST_SPEED;
      p.boostTick++;
      if (p.boostTick >= BOOST_COST_TICKS) {
        p.boostTick = 0;
        const tail = p.segments.pop();
        p.score = Math.max(START_LENGTH, p.score - 1);
        food.push({ id: foodIdCounter++, x: tail.x, y: tail.y, r: FOOD_RADIUS, color: p.color });
      }
    } else {
      p.speed = BASE_SPEED;
    }

    const head = p.segments[0];
    const nx = head.x + Math.cos(p.angle) * p.speed;
    const ny = head.y + Math.sin(p.angle) * p.speed;

    // world boundary: wrap-free, hitting the edge kills you (classic io behavior)
    if (nx < 0 || nx > WORLD_SIZE || ny < 0 || ny > WORLD_SIZE) {
      killPlayer(id);
      continue;
    }

    p.segments.unshift({ x: nx, y: ny });
    p.segments.pop(); // remove tail unless we grow this tick (handled in eating below)

    // eating food
    for (let i = food.length - 1; i >= 0; i--) {
      const f = food[i];
      if (dist2(nx, ny, f.x, f.y) < EAT_DISTANCE * EAT_DISTANCE) {
        food.splice(i, 1);
        // grow: duplicate tail segment
        const tail = p.segments[p.segments.length - 1];
        p.segments.push({ x: tail.x, y: tail.y });
        p.score += 1;
      }
    }
  }

  // replenish food that was eaten
  if (food.length < FOOD_COUNT) {
    spawnFood(Math.min(20, FOOD_COUNT - food.length));
  }

  // collision: head vs other worms' bodies
  for (const id of ids) {
    const p = players[id];
    if (!p.alive) continue;
    const head = p.segments[0];
    for (const otherId of ids) {
      const o = players[otherId];
      if (!o.alive) continue;
      const startIdx = otherId === id ? 6 : 0; // ignore own first few segments (avoid instant self-death on turns)
      for (let i = startIdx; i < o.segments.length; i++) {
        const s = o.segments[i];
        if (dist2(head.x, head.y, s.x, s.y) < (EAT_DISTANCE * 0.7) * (EAT_DISTANCE * 0.7)) {
          killPlayer(id);
          break;
        }
      }
      if (!p.alive) break;
    }
  }

  broadcastState();
}

function broadcastState() {
  const ids = Object.keys(players);
  const leaderboard = ids
    .filter(id => players[id].alive)
    .map(id => ({ id, name: players[id].name, score: players[id].score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  for (const id of ids) {
    const me = players[id];
    if (!me || !me.alive) {
      io.to(id).emit('state', { you: null, worms: [], food: [], leaderboard });
      continue;
    }
    // send everything (simple approach — fine for small/medium player counts)
    const worms = ids
      .filter(oid => players[oid].alive)
      .map(oid => ({
        id: oid,
        name: players[oid].name,
        color: players[oid].color,
        segments: players[oid].segments,
        score: players[oid].score
      }));

    io.to(id).emit('state', {
      you: { x: me.segments[0].x, y: me.segments[0].y, score: me.score, angle: me.angle },
      worms,
      food,
      leaderboard,
      worldSize: WORLD_SIZE
    });
  }
}

setInterval(tick, TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Worm game server running on port ${PORT}`);
});
