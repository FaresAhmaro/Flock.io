const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const WORLD = {
  w: 6000,
  h: 6000
};

const HUNGER_TIME = 300000;

const players = new Map();
const foods = [];

let nextPlayerId = 1;
let nextFoodId = 1;

/* =========================
   FOOD
========================= */

const FOOD = {
  grass:   { value: 5 },
  apple:   { value: 15 },
  corn:    { value: 20 },
  noodles: { value: 25 },
  momo:    { value: 30 },
  sushi:   { value: 35 },
  sashimi: { value: 40 },
  burger:  { value: 60 },
  pizza:   { value: 70 },
  donut:   { value: 80 },

  golden:  { value: 150, effect: "golden" },
  energy:  { value: 25, effect: "energy" },
  turbo:   { value: 20, effect: "turbo" },
  eagleeye:{ value: 15, effect: "radar" },
  shield:  { value: 15, effect: "shield" },
  magnet:  { value: 15, effect: "magnet" }
};

const normalFood = [
  "grass",
  "apple",
  "apple",
  "corn",
  "corn",
  "noodles",
  "momo",
  "sushi",
  "sashimi",
  "burger",
  "pizza",
  "donut"
];

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(random(min, max + 1));
}

function randomFood() {
  const r = Math.random();

  if (r < 0.01) return "golden";
  if (r < 0.025) return "energy";
  if (r < 0.04) return "turbo";
  if (r < 0.055) return "eagleeye";
  if (r < 0.07) return "shield";
  if (r < 0.085) return "magnet";

  return normalFood[randomInt(0, normalFood.length - 1)];
}

function spawnFood(x, y, key) {
  if (foods.length >= 1000) return;

  const foodKey = key || randomFood();

  foods.push({
    id: nextFoodId++,
    x: x === undefined ? random(30, WORLD.w - 30) : x,
    y: y === undefined ? random(30, WORLD.h - 30) : y,
    key: foodKey
  });
}

/* Fill world with food */

for (let i = 0; i < 1000; i++) {
  spawnFood();
}

/* =========================
   PLAYER
========================= */

function createPlayer(ws) {
  let sheep = 0;
  let wolves = 0;

  for (const p of players.values()) {
    if (p.role === "sheep") sheep++;
    if (p.role === "wolf") wolves++;
  }

  let role;

  if (sheep === 0) {
    role = "sheep";
  } else if (wolves === 0) {
    role = "wolf";
  } else {
    role = sheep <= wolves ? "sheep" : "wolf";
  }

  const player = {
    id: String(nextPlayerId++),

    name: role === "wolf" ? "Wolf" : "Sheep",
    flag: "🌍",

    role: role,
    alive: true,

    x: random(300, WORLD.w - 300),
    y: random(300, WORLD.h - 300),

    dx: 0,
    dy: 0,

    mass: role === "wolf" ? 250 : 100,

    hungerMs: HUNGER_TIME,

    boostMsLeft: 0,
    boostType: null,

    visionMsLeft: 0,
    shieldMsLeft: 0,
    magnetMsLeft: 0,

    shadow: false,

    kills: 0,

    ws: ws
  };

  players.set(player.id, player);

  return player;
}

/* =========================
   PLAYER RADIUS
========================= */

function getRadius(player) {
  const base = player.role === "wolf" ? 22 : 14;

  const scale = Math.min(
    1 + player.mass / (player.role === "wolf" ? 4000 : 20000),
    player.role === "wolf" ? 3.2 : 2.4
  );

  return base * scale;
}

/* =========================
   MOVEMENT
========================= */

function movePlayer(player) {
  if (!player.alive) return;

  let dx = Number(player.dx) || 0;
  let dy = Number(player.dy) || 0;

  const length = Math.hypot(dx, dy);

  if (length > 0) {
    dx /= length;
    dy /= length;
  }

  let speed =
    player.role === "wolf"
      ? 4.8
      : 4.2;

  if (player.boostMsLeft > 0) {
    speed *= 1.65;
  }

  player.x += dx * speed;
  player.y += dy * speed;

  const r = getRadius(player);

  player.x = Math.max(
    r,
    Math.min(WORLD.w - r, player.x)
  );

  player.y = Math.max(
    r,
    Math.min(WORLD.h - r, player.y)
  );
}

/* =========================
   FOOD
========================= */

function eatFood(player) {
  if (!player.alive) return;

  const radius = getRadius(player);

  for (let i = foods.length - 1; i >= 0; i--) {
    const food = foods[i];

    const d = Math.hypot(
      player.x - food.x,
      player.y - food.y
    );

    if (d > radius + 20) continue;

    const data = FOOD[food.key] || FOOD.grass;

    player.mass += data.value;

    player.hungerMs = HUNGER_TIME;

    if (data.effect === "golden") {
      player.boostMsLeft = 300000;
      player.boostType = "golden";
    }

    if (data.effect === "energy") {
      player.boostMsLeft = 300000;
      player.boostType = "energy";
    }

    if (data.effect === "turbo") {
      player.boostMsLeft = 300000;
      player.boostType = "turbo";
    }

    if (data.effect === "radar") {
      player.visionMsLeft = 300000;
    }

    if (data.effect === "shield") {
      player.shieldMsLeft = 300000;
    }

    if (data.effect === "magnet") {
      player.magnetMsLeft = 300000;
    }

    foods.splice(i, 1);

    spawnFood();
  }
}

/* =========================
   TIMERS
========================= */

function updateTimers(player) {
  if (!player.alive) return;

  player.hungerMs -= 1000 / 30;

  if (player.boostMsLeft > 0) {
    player.boostMsLeft -= 1000 / 30;

    if (player.boostMsLeft <= 0) {
      player.boostMsLeft = 0;
      player.boostType = null;
    }
  }

  if (player.visionMsLeft > 0) {
    player.visionMsLeft -= 1000 / 30;
  }

  if (player.shieldMsLeft > 0) {
    player.shieldMsLeft -= 1000 / 30;
  }

  if (player.magnetMsLeft > 0) {
    player.magnetMsLeft -= 1000 / 30;
  }

  if (player.hungerMs <= 0) {
    killPlayer(player);
  }
}

/* =========================
   KILL PLAYER
========================= */

function killPlayer(player, killer) {
  if (!player.alive) return;

  player.alive = false;

  /*
     Drop food when player dies.
  */

  const pieces = Math.min(
    60,
    Math.floor(player.mass / 10)
  );

  for (let i = 0; i < pieces; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = random(20, 120);

    spawnFood(
      player.x + Math.cos(angle) * distance,
      player.y + Math.sin(angle) * distance,
      randomFood()
    );
  }

  if (killer && killer.alive) {
    killer.kills++;
    killer.mass += Math.floor(player.mass * 0.25);
  }

  setTimeout(() => {
    if (players.has(player.id)) {
      respawn(player);
    }
  }, 3000);
}

/* =========================
   RESPAWN
========================= */

function respawn(player) {
  player.alive = true;

  player.x = random(300, WORLD.w - 300);
  player.y = random(300, WORLD.h - 300);

  player.mass =
    player.role === "wolf"
      ? 250
      : 100;

  player.hungerMs = HUNGER_TIME;

  player.boostMsLeft = 0;
  player.boostType = null;

  player.visionMsLeft = 0;
  player.shieldMsLeft = 0;
  player.magnetMsLeft = 0;

  player.dx = 0;
  player.dy = 0;
}

/* =========================
   COLLISIONS
========================= */

function collisions() {
  const list = [...players.values()]
    .filter(p => p.alive);

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];

      const d = Math.hypot(
        a.x - b.x,
        a.y - b.y
      );

      if (
        d >
        (getRadius(a) + getRadius(b)) * 0.7
      ) {
        continue;
      }

      if (
        a.shieldMsLeft > 0 ||
        b.shieldMsLeft > 0
      ) {
        continue;
      }

      /*
         Wolf catches sheep.
      */

      if (
        a.role === "wolf" &&
        b.role === "sheep"
      ) {
        if (a.mass >= b.mass * 0.55) {
          killPlayer(b, a);
        }
        continue;
      }

      if (
        b.role === "wolf" &&
        a.role === "sheep"
      ) {
        if (b.mass >= a.mass * 0.55) {
          killPlayer(a, b);
        }
        continue;
      }
    }
  }
}

/* =========================
   LEADERBOARD
========================= */

function leaderboard() {
  return [...players.values()]
    .filter(p => p.alive)
    .sort((a, b) => b.mass - a.mass)
    .slice(0, 8)
    .map(p => ({
      id: p.id,
      name: p.name,
      flag: p.flag,
      role: p.role,
      mass: Math.floor(p.mass)
    }));
}

/* =========================
   SERIALIZE PLAYER
========================= */

function serializePlayer(p) {
  return {
    id: p.id,
    name: p.name,
    flag: p.flag,

    role: p.role,
    alive: p.alive,

    x: p.x,
    y: p.y,

    mass: Math.floor(p.mass),

    hungerMs: Math.max(
      0,
      Math.floor(p.hungerMs)
    ),

    boostMsLeft: Math.max(
      0,
      Math.floor(p.boostMsLeft)
    ),

    boostType: p.boostType,

    visionMsLeft: Math.max(
      0,
      Math.floor(p.visionMsLeft)
    ),

    shieldMsLeft: Math.max(
      0,
      Math.floor(p.shieldMsLeft)
    ),

    magnetMsLeft: Math.max(
      0,
      Math.floor(p.magnetMsLeft)
    ),

    shadow: p.shadow
  };
}

/* =========================
   SEND STATE
========================= */

function sendState(player) {
  if (
    !player.ws ||
    player.ws.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  const nearbyPlayers = [];

  for (const p of players.values()) {
    if (!p.alive) continue;

    const d = Math.hypot(
      p.x - player.x,
      p.y - player.y
    );

    if (d <= 3200) {
      nearbyPlayers.push(
        serializePlayer(p)
      );
    }
  }

  const nearbyFood = foods
    .filter(food => {
      return (
        Math.abs(food.x - player.x) <= 3200 &&
        Math.abs(food.y - player.y) <= 3200
      );
    })
    .map(food => ({
      id: food.id,
      x: food.x,
      y: food.y,
      key: food.key,
      value:
        (FOOD[food.key] || FOOD.grass).value
    }));

  let kingSheep = null;
  let kingWolf = null;

  for (const p of players.values()) {
    if (!p.alive) continue;

    if (
      p.role === "sheep" &&
      (!kingSheep || p.mass > kingSheep.mass)
    ) {
      kingSheep = p;
    }

    if (
      p.role === "wolf" &&
      (!kingWolf || p.mass > kingWolf.mass)
    ) {
      kingWolf = p;
    }
  }

  const message = {
    type: "state",

    players: nearbyPlayers,

    foods: nearbyFood,

    kingSheepId:
      kingSheep ? kingSheep.id : null,

    kingWolfId:
      kingWolf ? kingWolf.id : null,

    leaderboard: leaderboard()
  };

  try {
    player.ws.send(
      JSON.stringify(message)
    );
  } catch (e) {
    console.log("Send error:", e.message);
  }
}

/* =========================
   HTTP SERVER
========================= */

const server = http.createServer(
  (req, res) => {

    if (req.url === "/health") {
      res.writeHead(200, {
        "Content-Type":
          "application/json"
      });

      res.end(
        JSON.stringify({
          status: "online",
          players: players.size
        })
      );

      return;
    }

    const filePath =
      path.join(
        __dirname,
        "index.html"
      );

    fs.readFile(
      filePath,
      (error, data) => {

        if (error) {
          res.writeHead(500, {
            "Content-Type":
              "text/plain"
          });

          res.end(
            "index.html not found"
          );

          return;
        }

        res.writeHead(200, {
          "Content-Type":
            "text/html"
        });

        res.end(data);
      }
    );
  }
);

/* =========================
   WEBSOCKET
========================= */

const wss =
  new WebSocket.Server({
    server: server
  });

wss.on("connection", ws => {

  const player =
    createPlayer(ws);

  console.log(
    "Player connected:",
    player.id,
    player.role
  );

  ws.send(
    JSON.stringify({
      type: "welcome",

      id: player.id,

      world: WORLD,

      hungerLimitMs:
        HUNGER_TIME
    })
  );

  ws.on("message", data => {

    try {

      const message =
        JSON.parse(
          data.toString()
        );

      if (
        message.type !== "input"
      ) {
        return;
      }

      player.dx =
        Number(message.dx) || 0;

      player.dy =
        Number(message.dy) || 0;

    } catch (error) {

      console.log(
        "Invalid message"
      );
    }
  });

  ws.on("close", () => {

    players.delete(
      player.id
    );

    console.log(
      "Player disconnected:",
      player.id
    );
  });

  ws.on("error", () => {

    players.delete(
      player.id
    );
  });
});

/* =========================
   GAME LOOP
========================= */

setInterval(() => {

  for (const player of players.values()) {

    if (!player.alive) continue;

    movePlayer(player);

    eatFood(player);

    updateTimers(player);
  }

  collisions();

}, 1000 / 30);

/* =========================
   SEND GAME STATE
========================= */

setInterval(() => {

  for (const player of players.values()) {
    sendState(player);
  }

}, 1000 / 15);

/* =========================
   KEEP FOOD FULL
========================= */

setInterval(() => {

  while (foods.length < 1000) {
    spawnFood();
  }

}, 1000);

/* =========================
   START SERVER
========================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "🐑 FLOCK.IO SERVER STARTED"
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "WORLD:",
      WORLD.w,
      "x",
      WORLD.h
    );

    console.log(
      "================================"
    );
  }
);
