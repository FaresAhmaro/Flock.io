```javascript
const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

/* =========================================================
   WORLD SETTINGS
========================================================= */

const WORLD = {
    w: 6000,
    h: 6000
};

const SETTINGS = {
    maxPlayers: 500,

    tickRate: 30,
    stateRate: 15,

    maxFood: 1000,

    hungerTime: 300000,

    boostTime: 300000,
    radarTime: 300000,
    shieldTime: 300000,
    magnetTime: 300000,

    sheepStartMass: 100,
    wolfStartMass: 250,

    sheepSpeed: 4.2,
    wolfSpeed: 4.8,

    boostMultiplier: 1.65,

    broadcastRadius: 3200
};


/* =========================================================
   FOOD
========================================================= */

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

    golden: {
        value: 150,
        effect: "golden"
    },

    energy: {
        value: 25,
        effect: "energy"
    },

    turbo: {
        value: 20,
        effect: "turbo"
    },

    eagleeye: {
        value: 15,
        effect: "radar"
    },

    shield: {
        value: 15,
        effect: "shield"
    },

    magnet: {
        value: 15,
        effect: "magnet"
    }
};

const foodKeys = Object.keys(FOOD);


/* =========================================================
   DATA
========================================================= */

const players = new Map();
const foods = [];

let nextPlayerId = 1;
let nextFoodId = 1;


/* =========================================================
   HELPERS
========================================================= */

function random(min, max) {
    return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
    return Math.floor(random(min, max + 1));
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
    return Math.hypot(
        a.x - b.x,
        a.y - b.y
    );
}

function normalize(x, y) {
    const d = Math.hypot(x, y);

    if (d < 0.0001) {
        return {
            x: 0,
            y: 0
        };
    }

    return {
        x: x / d,
        y: y / d
    };
}


/* =========================================================
   FOOD TYPE
========================================================= */

function randomFoodType() {

    const roll = Math.random();

    if (roll < 0.01) return "golden";
    if (roll < 0.025) return "energy";
    if (roll < 0.04) return "turbo";
    if (roll < 0.055) return "eagleeye";
    if (roll < 0.07) return "shield";
    if (roll < 0.085) return "magnet";

    const normal = [
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

    return normal[
        randomInt(0, normal.length - 1)
    ];
}


/* =========================================================
   SPAWN FOOD
========================================================= */

function spawnFood(x, y, key) {

    if (foods.length >= SETTINGS.maxFood) {
        return null;
    }

    const foodKey =
        key || randomFoodType();

    const type =
        FOOD[foodKey] || FOOD.grass;

    const food = {
        id: nextFoodId++,

        x: clamp(
            typeof x === "number"
                ? x
                : random(40, WORLD.w - 40),
            20,
            WORLD.w - 20
        ),

        y: clamp(
            typeof y === "number"
                ? y
                : random(40, WORLD.h - 40),
            20,
            WORLD.h - 20
        ),

        key: foodKey,

        value: type.value
    };

    foods.push(food);

    return food;
}


/* =========================================================
   INITIAL FOOD
========================================================= */

for (let i = 0; i < SETTINGS.maxFood; i++) {
    spawnFood();
}


/* =========================================================
   PLAYER
========================================================= */

function createPlayer(ws) {

    let sheepCount = 0;
    let wolfCount = 0;

    for (const p of players.values()) {

        if (p.role === "sheep") sheepCount++;
        if (p.role === "wolf") wolfCount++;
    }

    /*
      Keep teams reasonably balanced.
    */

    let role;

    if (sheepCount === 0) {
        role = "sheep";
    }
    else if (wolfCount === 0) {
        role = "wolf";
    }
    else if (sheepCount < wolfCount) {
        role = "sheep";
    }
    else if (wolfCount < sheepCount) {
        role = "wolf";
    }
    else {
        role =
            Math.random() < 0.5
                ? "sheep"
                : "wolf";
    }

    const isWolf = role === "wolf";

    const player = {

        id: String(nextPlayerId++),

        ws,

        name:
            isWolf
                ? "Wolf"
                : "Sheep",

        flag: "🌍",

        role,

        alive: true,

        x: random(
            300,
            WORLD.w - 300
        ),

        y: random(
            300,
            WORLD.h - 300
        ),

        vx: 0,
        vy: 0,

        input: {
            dx: 0,
            dy: 0,
            boost: false
        },

        mass:
            isWolf
                ? SETTINGS.wolfStartMass
                : SETTINGS.sheepStartMass,

        score: 0,

        kills: 0,

        hungerMs:
            SETTINGS.hungerTime,

        boostMsLeft: 0,

        boostType: null,

        visionMsLeft: 0,

        shieldMsLeft: 0,

        magnetMsLeft: 0,

        shadowMsLeft: 0,

        shadow: false,

        lastTick: Date.now()
    };

    players.set(
        player.id,
        player
    );

    return player;
}


/* =========================================================
   PLAYER SIZE
========================================================= */

function playerRadius(player) {

    const base =
        player.role === "wolf"
            ? 22
            : 15;

    const scale =
        Math.min(
            1 +
            player.mass /
            (player.role === "wolf"
                ? 4000
                : 20000),

            player.role === "wolf"
                ? 3.2
                : 2.8
        );

    return base * scale;
}


/* =========================================================
   PLAYER SPEED
========================================================= */

function playerSpeed(player) {

    let speed =
        player.role === "wolf"
            ? SETTINGS.wolfSpeed
            : SETTINGS.sheepSpeed;

    if (player.boostMsLeft > 0) {
        speed *= SETTINGS.boostMultiplier;
    }

    /*
      Bigger worms become slightly slower.
    */

    const penalty =
        Math.min(
            0.30,
            player.mass / 100000
        );

    speed *= (1 - penalty);

    return speed;
}


/* =========================================================
   MOVEMENT
========================================================= */

function updateMovement(player, dt) {

    if (!player.alive) {
        return;
    }

    let dx =
        Number(player.input.dx) || 0;

    let dy =
        Number(player.input.dy) || 0;

    /*
      Normalize client input.
    */

    const direction =
        normalize(dx, dy);

    dx = direction.x;
    dy = direction.y;

    if (dx === 0 && dy === 0) {

        player.vx *= 0.80;
        player.vy *= 0.80;

        player.x += player.vx * dt;
        player.y += player.vy * dt;

        keepInsideWorld(player);

        return;
    }

    const speed =
        playerSpeed(player);

    /*
      Smooth movement.
    */

    const acceleration =
        Math.min(
            1,
            0.25 * dt
        );

    player.vx +=
        (dx * speed - player.vx) *
        acceleration;

    player.vy +=
        (dy * speed - player.vy) *
        acceleration;

    /*
      Speed limit.
    */

    const velocity =
        Math.hypot(
            player.vx,
            player.vy
        );

    if (velocity > speed) {

        player.vx =
            player.vx /
            velocity *
            speed;

        player.vy =
            player.vy /
            velocity *
            speed;
    }

    player.x +=
        player.vx * dt;

    player.y +=
        player.vy * dt;

    keepInsideWorld(player);
}


/* =========================================================
   WORLD BOUNDARY
========================================================= */

function keepInsideWorld(player) {

    const r =
        playerRadius(player);

    if (player.x < r) {
        player.x = r;
        player.vx = Math.abs(player.vx) * 0.2;
    }

    if (player.y < r) {
        player.y = r;
        player.vy = Math.abs(player.vy) * 0.2;
    }

    if (player.x > WORLD.w - r) {
        player.x = WORLD.w - r;
        player.vx = -Math.abs(player.vx) * 0.2;
    }

    if (player.y > WORLD.h - r) {
        player.y = WORLD.h - r;
        player.vy = -Math.abs(player.vy) * 0.2;
    }
}


/* =========================================================
   BOOST
========================================================= */

function updateBoost(player, dt) {

    if (!player.alive) return;

    if (!player.input.boost) return;

    if (player.mass <= 35) return;

    /*
      Boost does NOT activate another timer.
      It consumes mass while held.
    */

    player.mass -=
        0.12 * dt;

    if (player.mass < 20) {
        player.mass = 20;
    }
}


/* =========================================================
   TIMERS
========================================================= */

function updateTimers(player, dtMs) {

    if (!player.alive) return;

    player.hungerMs -= dtMs;

    if (player.hungerMs <= 0) {

        killPlayer(
            player,
            "hunger",
            null
        );

        return;
    }

    if (player.boostMsLeft > 0) {

        player.boostMsLeft -= dtMs;

        if (player.boostMsLeft <= 0) {

            player.boostMsLeft = 0;
            player.boostType = null;
        }
    }

    if (player.visionMsLeft > 0) {

        player.visionMsLeft -= dtMs;

        if (player.visionMsLeft < 0) {
            player.visionMsLeft = 0;
        }
    }

    if (player.shieldMsLeft > 0) {

        player.shieldMsLeft -= dtMs;

        if (player.shieldMsLeft < 0) {
            player.shieldMsLeft = 0;
        }
    }

    if (player.magnetMsLeft > 0) {

        player.magnetMsLeft -= dtMs;

        if (player.magnetMsLeft < 0) {
            player.magnetMsLeft = 0;
        }
    }

    if (player.shadowMsLeft > 0) {

        player.shadowMsLeft -= dtMs;

        if (player.shadowMsLeft <= 0) {

            player.shadowMsLeft = 0;
            player.shadow = false;
        }
    }
}


/* =========================================================
   MAGNET
========================================================= */

function updateMagnet(player) {

    if (
        !player.alive ||
        player.magnetMsLeft <= 0
    ) {
        return;
    }

    const range = 250;

    for (const food of foods) {

        const dx =
            player.x - food.x;

        const dy =
            player.y - food.y;

        const d =
            Math.hypot(dx, dy);

        if (d <= 1 || d > range) {
            continue;
        }

        const force =
            Math.min(
                5,
                180 / d
            );

        food.x +=
            dx / d * force;

        food.y +=
            dy / d * force;
    }
}


/* =========================================================
   FOOD EFFECT
========================================================= */

function applyFoodEffect(player, key) {

    const type = FOOD[key];

    if (!type || !type.effect) {
        return;
    }

    switch (type.effect) {

        case "golden":

            player.boostMsLeft =
                SETTINGS.boostTime;

            player.boostType =
                "golden";

            break;


        case "energy":

            player.boostMsLeft =
                SETTINGS.boostTime;

            player.boostType =
                "energy";

            break;


        case "turbo":

            player.boostMsLeft =
                SETTINGS.boostTime;

            player.boostType =
                "turbo";

            break;


        case "radar":

            player.visionMsLeft =
                SETTINGS.radarTime;

            break;


        case "shield":

            player.shieldMsLeft =
                SETTINGS.shieldTime;

            break;


        case "magnet":

            player.magnetMsLeft =
                SETTINGS.magnetTime;

            break;
    }
}


/* =========================================================
   EAT FOOD
========================================================= */

function eatFood(player) {

    if (!player.alive) return;

    const radius =
        playerRadius(player);

    const eatingRange =
        radius + 20;

    for (
        let i = foods.length - 1;
        i >= 0;
        i--
    ) {

        const food = foods[i];

        if (
            Math.abs(
                player.x - food.x
            ) > eatingRange
        ) {
            continue;
        }

        if (
            Math.abs(
                player.y - food.y
            ) > eatingRange
        ) {
            continue;
        }

        const d =
            distance(
                player,
                food
            );

        if (d > eatingRange) {
            continue;
        }

        /*
          Eat it.
        */

        player.mass += food.value;

        player.score += food.value;

        /*
          Eating resets hunger.
        */

        player.hungerMs =
            SETTINGS.hungerTime;

        applyFoodEffect(
            player,
            food.key
        );

        foods.splice(
            i,
            1
        );

        /*
          Replace consumed food.
        */

        spawnFood();
    }
}


/* =========================================================
   PLAYER COLLISION
========================================================= */

function checkPlayerCollisions() {

    const alivePlayers =
        [...players.values()]
            .filter(
                p => p.alive
            );

    for (
        let i = 0;
        i < alivePlayers.length;
        i++
    ) {

        const a =
            alivePlayers[i];

        for (
            let j = i + 1;
            j < alivePlayers.length;
            j++
        ) {

            const b =
                alivePlayers[j];

            if (
                !a.alive ||
                !b.alive
            ) {
                continue;
            }

            /*
              Very close heads.
            */

            const d =
                distance(a, b);

            const ra =
                playerRadius(a);

            const rb =
                playerRadius(b);

            if (
                d >
                (ra + rb) * 0.75
            ) {
                continue;
            }

            /*
              Shield protects the player.
            */

            if (
                a.shieldMsLeft > 0 ||
                b.shieldMsLeft > 0
            ) {
                continue;
            }

            /*
              Wolf can hunt sheep.
            */

            if (
                a.role === "wolf" &&
                b.role === "sheep"
            ) {

                if (
                    a.mass >=
                    b.mass * 0.55
                ) {

                    killPlayer(
                        b,
                        "wolf",
                        a
                    );
                }

                continue;
            }

            if (
                b.role === "wolf" &&
                a.role === "sheep"
            ) {

                if (
                    b.mass >=
                    a.mass * 0.55
                ) {

                    killPlayer(
                        a,
                        "wolf",
                        b
                    );
                }

                continue;
            }

            /*
              Same-role collision.
            */

            if (
                a.mass >
                b.mass * 1.15
            ) {

                killPlayer(
                    b,
                    "collision",
                    a
                );

            }
            else if (
                b.mass >
                a.mass * 1.15
            ) {

                killPlayer(
                    a,
                    "collision",
                    b
                );
            }
        }
    }
}


/* =========================================================
   DROP FOOD
========================================================= */

function dropFood(player) {

    const amount =
        Math.min(
            70,
            Math.floor(
                player.mass / 10
            )
        );

    if (amount <= 0) {
        return;
    }

    const value =
        Math.max(
            5,
            player.mass /
            amount *
            0.8
        );

    for (
        let i = 0;
        i < amount;
        i++
    ) {

        const angle =
            Math.random() *
            Math.PI *
            2;

        const radius =
            random(
                25,
                140
            );

        let key = "grass";

        if (value >= 70) {
            key = "donut";
        }
        else if (value >= 55) {
            key = "burger";
        }
        else if (value >= 35) {
            key = "pizza";
        }
        else if (value >= 25) {
            key = "momo";
        }
        else if (value >= 15) {
            key = "apple";
        }

        spawnFood(
            player.x +
            Math.cos(angle) *
            radius,

            player.y +
            Math.sin(angle) *
            radius,

            key
        );
    }
}


/* =========================================================
   KILL
========================================================= */

function killPlayer(
    player,
    reason,
    killer
) {

    if (!player.alive) {
        return;
    }

    player.alive = false;

    /*
      Killer reward.
    */

    if (killer && killer.alive) {

        killer.kills++;

        killer.score +=
            Math.floor(
                player.mass * 0.5
            );

        killer.mass +=
            Math.floor(
                player.mass * 0.25
            );
    }

    dropFood(player);

    /*
      Respawn.
    */

    setTimeout(() => {

        if (!players.has(player.id)) {
            return;
        }

        respawn(player);

    }, 3000);

    console.log(
        `Player ${player.id} died (${reason})`
    );
}


/* =========================================================
   RESPAWN
========================================================= */

function respawn(player) {

    player.alive = true;

    player.x =
        random(
            300,
            WORLD.w - 300
        );

    player.y =
        random(
            300,
            WORLD.h - 300
        );

    player.vx = 0;
    player.vy = 0;

    player.mass =
        player.role === "wolf"
            ? SETTINGS.wolfStartMass
            : SETTINGS.sheepStartMass;

    player.score = 0;
    player.kills = 0;

    player.hungerMs =
        SETTINGS.hungerTime;

    player.boostMsLeft = 0;
    player.boostType = null;

    player.visionMsLeft = 0;
    player.shieldMsLeft = 0;
    player.magnetMsLeft = 0;
    player.shadowMsLeft = 0;

    player.shadow = false;
}


/* =========================================================
   KING
========================================================= */

function getKing(role) {

    let king = null;

    for (const player of players.values()) {

        if (
            !player.alive ||
            player.role !== role
        ) {
            continue;
        }

        if (
            !king ||
            player.mass > king.mass
        ) {
            king = player;
        }
    }

    return king;
}


/* =========================================================
   LEADERBOARD
========================================================= */

function getLeaderboard() {

    return [...players.values()]
        .filter(
            p => p.alive
        )
        .sort(
            (a, b) =>
                b.mass - a.mass
        )
        .slice(0, 10)
        .map(p => ({
            id: p.id,
            name: p.name,
            flag: p.flag,
            role: p.role,
            mass: Math.floor(p.mass)
        }));
}


/* =========================================================
   PLAYER SERIALIZATION
========================================================= */

function serializePlayer(player) {

    return {

        id: player.id,

        name: player.name,

        flag: player.flag,

        role: player.role,

        alive: player.alive,

        x: Math.round(player.x * 10) / 10,

        y: Math.round(player.y * 10) / 10,

        mass: Math.floor(player.mass),

        hungerMs:
            Math.max(
                0,
                Math.floor(
                    player.hungerMs
                )
            ),

        boostMsLeft:
            Math.max(
                0,
                Math.floor(
                    player.boostMsLeft
                )
            ),

        boostType:
            player.boostType,

        visionMsLeft:
            Math.max(
                0,
                Math.floor(
                    player.visionMsLeft
                )
            ),

        shieldMsLeft:
            Math.max(
                0,
                Math.floor(
                    player.shieldMsLeft
                )
            ),

        magnetMsLeft:
            Math.max(
                0,
                Math.floor(
                    player.magnetMsLeft
                )
            ),

        shadowMsLeft:
            Math.max(
                0,
                Math.floor(
                    player.shadowMsLeft
                )
            ),

        shadow:
            player.shadow
    };
}


/* =========================================================
   FOOD SERIALIZATION
========================================================= */

function serializeFood(food) {

    return {
        id: food.id,

        x: Math.round(food.x * 10) / 10,

        y: Math.round(food.y * 10) / 10,

        key: food.key,

        value: food.value
    };
}


/* =========================================================
   NEARBY PLAYERS
========================================================= */

function getNearbyPlayers(player) {

    const radius =
        SETTINGS.broadcastRadius;

    const result = [];

    for (const other of players.values()) {

        if (
            other.id !== player.id &&
            !other.alive
        ) {
            continue;
        }

        /*
          Shadow players cannot normally
          be seen without radar.
        */

        if (
            other.id !== player.id &&
            other.shadow &&
            player.visionMsLeft <= 0
        ) {
            continue;
        }

        if (
            Math.abs(
                other.x - player.x
            ) > radius
        ) {
            continue;
        }

        if (
            Math.abs(
                other.y - player.y
            ) > radius
        ) {
            continue;
        }

        result.push(
            serializePlayer(other)
        );
    }

    return result;
}


/* =========================================================
   NEARBY FOOD
========================================================= */

function getNearbyFood(player) {

    const radius =
        SETTINGS.broadcastRadius;

    return foods
        .filter(food => {

            return (
                Math.abs(
                    food.x - player.x
                ) <= radius
                &&
                Math.abs(
                    food.y - player.y
                ) <= radius
            );

        })
        .map(
            serializeFood
        );
}


/* =========================================================
   SEND STATE
========================================================= */

function sendState(player) {

    if (
        !player.ws ||
        player.ws.readyState !==
        WebSocket.OPEN
    ) {
        return;
    }

    const sheepKing =
        getKing("sheep");

    const wolfKing =
        getKing("wolf");

    const packet = {

        type: "state",

        players:
            getNearbyPlayers(player),

        foods:
            getNearbyFood(player),

        kingSheepId:
            sheepKing
                ? sheepKing.id
                : null,

        kingWolfId:
            wolfKing
                ? wolfKing.id
                : null,

        leaderboard:
            getLeaderboard()
    };

    try {

        player.ws.send(
            JSON.stringify(packet)
        );

    }
    catch (error) {

        console.error(
            "WebSocket send error:",
            error.message
        );
    }
}


/* =========================================================
   HTTP SERVER
========================================================= */

const httpServer =
    http.createServer(
        (req, res) => {

            /*
              Health check.
            */

            if (req.url === "/health") {

                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            "application/json"
                    }
                );

                res.end(
                    JSON.stringify({
                        online: true,
                        players:
                            players.size,
                        food:
                            foods.length
                    })
                );

                return;
            }

            /*
              Serve index.html.
            */

            const file =
                path.join(
                    __dirname,
                    "index.html"
                );

            fs.readFile(
                file,
                (err, data) => {

                    if (err) {

                        res.writeHead(
                            500,
                            {
                                "Content-Type":
                                    "text/plain"
                            }
                        );

                        res.end(
                            "index.html not found"
                        );

                        return;
                    }

                    res.writeHead(
                        200,
                        {
                            "Content-Type":
                                "text/html"
                        }
                    );

                    res.end(data);
                }
            );
        }
    );


/* =========================================================
   WEBSOCKET SERVER
========================================================= */

const wss =
    new WebSocket.Server({
        server: httpServer
    });


wss.on(
    "connection",
    (ws) => {

        if (
            players.size >=
            SETTINGS.maxPlayers
        ) {

            ws.close(
                1013,
                "Server full"
            );

            return;
        }

        const player =
            createPlayer(ws);

        console.log(
            `CONNECTED: ${player.id} ${player.role}`
        );


        /*
          WELCOME
        */

        ws.send(
            JSON.stringify({

                type: "welcome",

                id: player.id,

                world: WORLD,

                hungerLimitMs:
                    SETTINGS.hungerTime
            })
        );


        /*
          INPUT
        */

        ws.on(
            "message",
            data => {

                try {

                    const msg =
                        JSON.parse(
                            data.toString()
                        );

                    if (
                        msg.type !==
                        "input"
                    ) {
                        return;
                    }

                    let dx =
                        Number(msg.dx);

                    let dy =
                        Number(msg.dy);

                    if (!Number.isFinite(dx))
                        dx = 0;

                    if (!Number.isFinite(dy))
                        dy = 0;

                    /*
                      Limit client input.
                    */

                    dx =
                        clamp(
                            dx,
                            -1000,
                            1000
                        );

                    dy =
                        clamp(
                            dy,
                            -1000,
                            1000
                        );

                    player.input.dx = dx;
                    player.input.dy = dy;

                    player.input.boost =
                        msg.boost === true;

                }
                catch (error) {

                    console.log(
                        "Invalid packet from",
                        player.id
                    );
                }
            }
        );


        /*
          DISCONNECT
        */

        ws.on(
            "close",
            () => {

                players.delete(
                    player.id
                );

                console.log(
                    `DISCONNECTED: ${player.id}`
                );
            }
        );


        ws.on(
            "error",
            () => {

                players.delete(
                    player.id
                );
            }
        );
    }
);


/* =========================================================
   GAME LOOP
========================================================= */

let lastTime =
    Date.now();

setInterval(
    () => {

        const now =
            Date.now();

        let dt =
            (now - lastTime) /
            1000;

        lastTime = now;

        /*
          Protect against huge jumps.
        */

        dt =
            Math.min(
                dt,
                0.1
            );

        for (
            const player
            of players.values()
        ) {

            if (!player.alive)
                continue;

            updateMovement(
                player,
                dt
            );

            updateBoost(
                player,
                dt
            );

            updateTimers(
                player,
                dt * 1000
            );

            updateMagnet(
                player
            );

            eatFood(
                player
            );
        }

        checkPlayerCollisions();

    },
    1000 / SETTINGS.tickRate
);


/* =========================================================
   STATE LOOP
========================================================= */

setInterval(
    () => {

        for (
            const player
            of players.values()
        ) {

            sendState(player);
        }

    },
    1000 / SETTINGS.stateRate
);


/* =========================================================
   FOOD MAINTENANCE
========================================================= */

setInterval(
    () => {

        while (
            foods.length <
            SETTINGS.maxFood
        ) {

            spawnFood();

        }

    },
    1000
);


/* =========================================================
   CLEANUP
========================================================= */

setInterval(
    () => {

        for (
            const [id, player]
            of players
        ) {

            if (
                !player.ws ||
                player.ws.readyState ===
                WebSocket.CLOSED
            ) {

                players.delete(id);
            }
        }

    },
    10000
);


/* =========================================================
   ERRORS
========================================================= */

process.on(
    "uncaughtException",
    error => {

        console.error(
            "SERVER ERROR:",
            error
        );
    }
);


process.on(
    "unhandledRejection",
    error => {

        console.error(
            "PROMISE ERROR:",
            error
        );
    }
);


/* =========================================================
   START
========================================================= */

httpServer.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "================================"
        );
        console.log(
            "🐑 FLOCK.IO SERVER ONLINE"
        );
        console.log(
            "================================"
        );
        console.log(
            `http://localhost:${PORT}`
        );
        console.log(
            `Players: ${players.size}`
        );
        console.log(
            `Food: ${foods.length}`
        );
        console.log(
            "================================"
        );
        console.log("");
    }
);
```
