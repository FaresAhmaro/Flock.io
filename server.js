```javascript
const http = require("http");
const WebSocket = require("ws");

/*
============================================================
FLOCK.IO
WORMATE-STYLE MULTIPLAYER SERVER
============================================================

Run:

    npm install ws
    node server.js

The server provides:

- WebSocket multiplayer
- Sheep / Wolf roles
- Worm movement
- Food
- Growth
- Hunger
- Powerups
- Boost
- Radar
- Shield
- Magnet
- Shadow
- Collision
- Death
- Food drops
- Leaderboard
- King system
============================================================
*/


/* ============================================================
   SERVER
============================================================ */

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {

    if (req.url === "/health") {

        res.writeHead(200, {
            "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
            ok: true,
            players: players.size,
            food: foods.length
        }));

        return;
    }

    res.writeHead(200, {
        "Content-Type": "text/html"
    });

    res.end(`
        <html>
        <head>
            <title>Flock.io Server</title>
        </head>
        <body style="font-family:Arial;background:#111;color:white">
            <h1>🐑 Flock.io Server Online</h1>
            <p>Players: ${players.size}</p>
            <p>Food: ${foods.length}</p>
        </body>
        </html>
    `);

});


const wss = new WebSocket.Server({
    server
});


server.listen(PORT, () => {

    console.log(`
========================================
🐑 FLOCK.IO SERVER
========================================

Server running on port ${PORT}

WebSocket:
ws://localhost:${PORT}

========================================
`);

});


/* ============================================================
   WORLD
============================================================ */

const WORLD = {
    w: 6000,
    h: 6000
};


/* ============================================================
   GAME SETTINGS
============================================================ */

const SETTINGS = {

    tickRate: 30,

    stateRate: 15,

    maxPlayers: 500,

    maxFood: 900,

    startingMassSheep: 100,

    startingMassWolf: 250,

    sheepSpeed: 4.3,

    wolfSpeed: 4.8,

    boostSpeedMultiplier: 1.65,

    boostDrainPerSecond: 0.35,

    growthPerMass: 1,

    hungerTime: 300000,

    boostTime: 300000,

    radarTime: 300000,

    shieldTime: 300000,

    magnetTime: 300000,

    shadowTime: 300000,

    foodDropMultiplier: 0.45,

    collisionPadding: 0.7,

    foodSpawnBatch: 15,

    broadcastRadius: 2500

};


/* ============================================================
   DATA
============================================================ */

const players = new Map();

const foods = [];

let nextPlayerId = 1;

let nextFoodId = 1;


/* ============================================================
   FOOD TYPES
============================================================ */

const FOOD_TYPES = {

    grass: {
        value: 5,
        color: "#78d84d",
        chance: 30
    },

    apple: {
        value: 15,
        chance: 16
    },

    corn: {
        value: 20,
        chance: 12
    },

    noodles: {
        value: 25,
        chance: 8
    },

    momo: {
        value: 30,
        chance: 7
    },

    sushi: {
        value: 35,
        chance: 6
    },

    sashimi: {
        value: 40,
        chance: 5
    },

    burger: {
        value: 60,
        chance: 4
    },

    pizza: {
        value: 70,
        chance: 3
    },

    donut: {
        value: 80,
        chance: 2
    },

    golden: {
        value: 150,
        boost: "golden",
        chance: 1.5
    },

    energy: {
        value: 25,
        boost: "energy",
        chance: 1.5
    },

    turbo: {
        value: 20,
        boost: "turbo",
        chance: 1
    },

    eagleeye: {
        value: 15,
        boost: "eagleeye",
        chance: 1
    },

    shield: {
        value: 15,
        boost: "shield",
        chance: 1
    },

    magnet: {
        value: 15,
        boost: "magnet",
        chance: 1
    }

};


/* ============================================================
   UTILITIES
============================================================ */

function random(min, max) {

    return Math.random() * (max - min) + min;

}


function randomInt(min, max) {

    return Math.floor(
        random(min, max + 1)
    );

}


function distance(a, b) {

    return Math.hypot(
        a.x - b.x,
        a.y - b.y
    );

}


function clamp(value, min, max) {

    return Math.max(
        min,
        Math.min(max, value)
    );

}


function normalize(x, y) {

    const length =
        Math.hypot(x, y) || 1;

    return {
        x: x / length,
        y: y / length
    };

}


function createId(prefix) {

    return (
        prefix +
        Math.random()
            .toString(36)
            .slice(2, 8) +
        Date.now()
            .toString(36)
    );

}


/* ============================================================
   FOOD RANDOMIZER
============================================================ */

function randomFoodType() {

    const entries =
        Object.entries(FOOD_TYPES);

    let total = 0;

    for (const [, type] of entries) {

        total += type.chance;

    }

    let roll =
        Math.random() * total;

    for (const [key, type] of entries) {

        roll -= type.chance;

        if (roll <= 0) {

            return key;

        }

    }

    return "grass";

}


/* ============================================================
   SPAWN FOOD
============================================================ */

function spawnFood(x, y, key) {

    if (foods.length >= SETTINGS.maxFood)
        return null;


    const type =
        key || randomFoodType();


    const food = {

        id: nextFoodId++,

        x:
            clamp(
                x ?? random(40, WORLD.w - 40),
                20,
                WORLD.w - 20
            ),

        y:
            clamp(
                y ?? random(40, WORLD.h - 40),
                20,
                WORLD.h - 20
            ),

        key: type,

        value:
            FOOD_TYPES[type].value

    };


    foods.push(food);

    return food;

}


/* ============================================================
   INITIAL FOOD
============================================================ */

for (
    let i = 0;
    i < SETTINGS.maxFood;
    i++
) {

    spawnFood();

}


/* ============================================================
   PLAYER CREATION
============================================================ */

function createPlayer(ws) {

    const id =
        String(nextPlayerId++);


    /*
    Alternate roles.

    You can later replace this with
    proper role balancing.
    */

    let sheepCount = 0;
    let wolfCount = 0;

    for (const p of players.values()) {

        if (p.role === "sheep")
            sheepCount++;

        if (p.role === "wolf")
            wolfCount++;

    }


    let role;

    if (sheepCount === 0) {

        role = "sheep";

    }
    else if (wolfCount === 0) {

        role = "wolf";

    }
    else {

        role =
            sheepCount <= wolfCount
                ? "sheep"
                : "wolf";

    }


    const isWolf =
        role === "wolf";


    const player = {

        id,

        ws,

        name:
            isWolf
                ? "Wolf"
                : "Sheep",


        flag: "🌍",


        role,


        alive: true,


        x:
            random(
                500,
                WORLD.w - 500
            ),

        y:
            random(
                500,
                WORLD.h - 500
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
                ? SETTINGS.startingMassWolf
                : SETTINGS.startingMassSheep,


        score: 0,


        hungerMs:
            SETTINGS.hungerTime,


        boostMsLeft: 0,
        boostType: null,


        visionMsLeft: 0,

        shieldMsLeft: 0,

        magnetMsLeft: 0,

        shadowMsLeft: 0,


        shadow: false,


        bodyLength: 10,


        lastUpdate: Date.now(),


        lastEat: 0,


        kills: 0,


        createdAt: Date.now()

    };


    updateBodyLength(player);


    players.set(
        id,
        player
    );


    return player;

}


/* ============================================================
   BODY LENGTH
============================================================ */

function updateBodyLength(player) {

    player.bodyLength =
        Math.max(
            8,
            Math.min(
                180,
                Math.floor(
                    8 +
                    Math.sqrt(
                        player.mass
                    ) * 1.9
                )
            )
        );

}


/* ============================================================
   PLAYER RADIUS
============================================================ */

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


/* ============================================================
   PLAYER SPEED
============================================================ */

function playerSpeed(player) {

    let speed =
        player.role === "wolf"
            ? SETTINGS.wolfSpeed
            : SETTINGS.sheepSpeed;


    if (player.boostMsLeft > 0) {

        speed *=
            SETTINGS.boostSpeedMultiplier;

    }


    /*
    Large worms are slightly slower.
    */

    const massPenalty =
        Math.min(
            0.35,
            player.mass / 100000
        );


    speed *=
        1 - massPenalty;


    return speed;

}


/* ============================================================
   APPLY INPUT
============================================================ */

function updatePlayerMovement(player, dt) {

    if (!player.alive)
        return;


    let dx =
        Number(player.input.dx) || 0;

    let dy =
        Number(player.input.dy) || 0;


    /*
    Prevent clients from sending absurd values.
    */

    dx =
        clamp(dx, -1000, 1000);

    dy =
        clamp(dy, -1000, 1000);


    const length =
        Math.hypot(dx, dy);


    if (length < 1) {

        player.vx *= 0.82;
        player.vy *= 0.82;

        return;

    }


    dx /= length;
    dy /= length;


    const speed =
        playerSpeed(player);


    /*
    Smooth acceleration.
    */

    const acceleration =
        0.45;


    player.vx +=
        (dx * speed - player.vx) *
        acceleration;


    player.vy +=
        (dy * speed - player.vy) *
        acceleration;


    const maxSpeed =
        speed;


    const velocity =
        Math.hypot(
            player.vx,
            player.vy
        );


    if (velocity > maxSpeed) {

        player.vx =
            player.vx /
            velocity *
            maxSpeed;

        player.vy =
            player.vy /
            velocity *
            maxSpeed;

    }


    player.x +=
        player.vx * dt;


    player.y +=
        player.vy * dt;


    /*
    World boundary.
    */

    const radius =
        playerRadius(player);


    if(player.x < radius){

        player.x = radius;
        player.vx *= -0.3;

    }


    if(player.y < radius){

        player.y = radius;
        player.vy *= -0.3;

    }


    if(player.x > WORLD.w-radius){

        player.x =
            WORLD.w-radius;

        player.vx *= -0.3;

    }


    if(player.y > WORLD.h-radius){

        player.y =
            WORLD.h-radius;

        player.vy *= -0.3;

    }

}


/* ============================================================
   BOOST
============================================================ */

function updateBoost(player, dt) {

    if(!player.input.boost)
        return;


    if(player.boostMsLeft > 0)
        return;


    /*
    Energy cost.

    Mass slowly decreases while boosting.
    */

    if(player.mass <= 30)
        return;


    player.mass -=
        SETTINGS.boostDrainPerSecond *
        dt;


    updateBodyLength(player);

}


/* ============================================================
   TIMERS
============================================================ */

function updateTimers(player, dtMs) {

    player.hungerMs -= dtMs;


    if(player.boostMsLeft > 0){

        player.boostMsLeft -= dtMs;

        if(player.boostMsLeft <= 0){

            player.boostMsLeft = 0;
            player.boostType = null;

        }

    }


    if(player.visionMsLeft > 0){

        player.visionMsLeft -= dtMs;

        if(player.visionMsLeft < 0)
            player.visionMsLeft = 0;

    }


    if(player.shieldMsLeft > 0){

        player.shieldMsLeft -= dtMs;

        if(player.shieldMsLeft < 0)
            player.shieldMsLeft = 0;

    }


    if(player.magnetMsLeft > 0){

        player.magnetMsLeft -= dtMs;

        if(player.magnetMsLeft < 0)
            player.magnetMsLeft = 0;

    }


    if(player.shadowMsLeft > 0){

        player.shadowMsLeft -= dtMs;

        if(player.shadowMsLeft <= 0){

            player.shadowMsLeft = 0;
            player.shadow = false;

        }

    }


    /*
    Hunger death.

    You can change this later to damage
    instead of instant death.
    */

    if(player.hungerMs <= 0){

        killPlayer(
            player,
            "hunger"
        );

    }

}


/* ============================================================
   FOOD MAGNET
============================================================ */

function updateMagnet(player) {

    if(player.magnetMsLeft <= 0)
        return;


    const range=220;


    for(const food of foods){

        const dx=
            player.x-food.x;

        const dy=
            player.y-food.y;


        const d=
            Math.hypot(dx,dy);


        if(d<=0 || d>range)
            continue;


        const pull=
            Math.min(
                8,
                180/d
            );


        food.x +=
            dx/d*pull;

        food.y +=
            dy/d*pull;

    }

}


/* ============================================================
   FOOD COLLISION
============================================================ */

function eatFood(player) {

    if(!player.alive)
        return;


    const radius =
        playerRadius(player);


    for(
        let i=foods.length-1;
        i>=0;
        i--
    ){

        const food=foods[i];


        const d=
            Math.hypot(
                player.x-food.x,
                player.y-food.y
            );


        if(
            d >
            radius + 18
        )
            continue;


        /*
        EAT
        */

        player.mass +=
            food.value;


        player.score +=
            food.value;


        player.hungerMs =
            SETTINGS.hungerTime;


        player.lastEat =
            Date.now();


        applyFoodEffect(
            player,
            food.key
        );


        foods.splice(
            i,
            1
        );


        /*
        Replace food.
        */

        spawnFood();

    }


    updateBodyLength(player);

}


/* ============================================================
   FOOD EFFECTS
============================================================ */

function applyFoodEffect(
    player,
    key
){

    const type =
        FOOD_TYPES[key];


    if(!type)
        return;


    if(
        key === "golden"
    ){

        player.boostMsLeft =
            SETTINGS.boostTime;

        player.boostType =
            "golden";

    }


    if(
        key === "energy"
    ){

        player.boostMsLeft =
            SETTINGS.boostTime;

        player.boostType =
            "energy";

    }


    if(
        key === "turbo"
    ){

        player.boostMsLeft =
            SETTINGS.boostTime;

        player.boostType =
            "turbo";

    }


    if(
        key === "eagleeye"
    ){

        player.visionMsLeft =
            SETTINGS.radarTime;

    }


    if(
        key === "shield"
    ){

        player.shieldMsLeft =
            SETTINGS.shieldTime;

    }


    if(
        key === "magnet"
    ){

        player.magnetMsLeft =
            SETTINGS.magnetTime;

    }

}


/* ============================================================
   PLAYER COLLISION
============================================================ */

function checkPlayerCollisions() {

    const alive =
        [...players.values()]
        .filter(
            p=>p.alive
        );


    for(let i=0;i<alive.length;i++){

        const a=alive[i];


        for(
            let j=i+1;
            j<alive.length;
            j++
        ){

            const b=alive[j];


            if(!a.alive || !b.alive)
                continue;


            const d=
                Math.hypot(
                    a.x-b.x,
                    a.y-b.y
                );


            const ra=
                playerRadius(a);


            const rb=
                playerRadius(b);


            /*
            Simple head-to-head collision.

            The larger player wins.
            */

            if(
                d >
                (ra+rb)*
                SETTINGS.collisionPadding
            )
                continue;


            if(
                a.shieldMsLeft>0 ||
                b.shieldMsLeft>0
            )
                continue;


            if(
                a.mass >=
                b.mass*1.05
            ){

                killPlayer(
                    b,
                    "collision",
                    a
                );

            }
            else if(
                b.mass >=
                a.mass*1.05
            ){

                killPlayer(
                    a,
                    "collision",
                    b
                );

            }

        }

    }

}


/* ============================================================
   KILL PLAYER
============================================================ */

function killPlayer(
    player,
    reason,
    killer=null
){

    if(!player.alive)
        return;


    player.alive=false;


    if(killer){

        killer.kills++;

        killer.score +=
            Math.floor(
                player.mass*.5
            );

        killer.mass +=
            Math.floor(
                player.mass*.25
            );

        updateBodyLength(killer);

    }


    /*
    Drop food around death location.
    */

    const dropCount =
        Math.min(
            80,
            Math.floor(
                player.mass *
                SETTINGS.foodDropMultiplier /
                10
            )
        );


    for(
        let i=0;
        i<dropCount;
        i++
    ){

        const angle=
            Math.random()*
            Math.PI*2;


        const distance=
            random(
                20,
                100
            );


        const value=
            Math.max(
                5,
                Math.floor(
                    player.mass/
                    dropCount
                )
            );


        let key="grass";


        if(value>=80)
            key="donut";
        else if(value>=60)
            key="burger";
        else if(value>=40)
            key="pizza";
        else if(value>=25)
            key="momo";
        else if(value>=15)
            key="apple";


        spawnFood(
            player.x+
            Math.cos(angle)*
            distance,

            player.y+
            Math.sin(angle)*
            distance,

            key
        );

    }


    console.log(
        `Player ${player.id} died: ${reason}`
    );


    /*
    Respawn after delay.

    For a real competitive game you may
    want a lobby instead.
    */

    setTimeout(()=>{

        if(!players.has(player.id))
            return;


        respawnPlayer(player);

    },3000);

}


/* ============================================================
   RESPAWN
============================================================ */

function respawnPlayer(player){

    player.alive=true;


    player.x=
        random(
            500,
            WORLD.w-500
        );


    player.y=
        random(
            500,
            WORLD.h-500
        );


    player.vx=0;
    player.vy=0;


    player.mass=
        player.role==="wolf"
            ? SETTINGS.startingMassWolf
            : SETTINGS.startingMassSheep;


    player.score=0;

    player.kills=0;


    player.hungerMs=
        SETTINGS.hungerTime;


    player.boostMsLeft=0;
    player.boostType=null;

    player.visionMsLeft=0;
    player.shieldMsLeft=0;
    player.magnetMsLeft=0;
    player.shadowMsLeft=0;

    player.shadow=false;


    updateBodyLength(player);

}


/* ============================================================
   KING SYSTEM
============================================================ */

function getKing(role){

    let king=null;


    for(const player of players.values()){

        if(
            !player.alive ||
            player.role!==role
        )
            continue;


        if(
            !king ||
            player.mass>king.mass
        ){

            king=player;

        }

    }


    return king;

}


/* ============================================================
   LEADERBOARD
============================================================ */

function getLeaderboard(){

    return [...players.values()]

        .filter(
            p=>p.alive
        )

        .sort(
            (a,b)=>
                b.mass-a.mass
        )

        .slice(
            0,
            10
        )

        .map(
            p=>({

                id:p.id,

                name:p.name,

                flag:p.flag,

                role:p.role,

                mass:Math.floor(
                    p.mass
                )

            })
        );

}


/* ============================================================
   SERIALIZE PLAYER
============================================================ */

function serializePlayer(player){

    return {

        id:player.id,

        name:player.name,

        flag:player.flag,

        role:player.role,

        alive:player.alive,

        x:Math.round(player.x*10)/10,

        y:Math.round(player.y*10)/10,

        mass:Math.floor(player.mass),

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


/* ============================================================
   SERIALIZE FOOD
============================================================ */

function serializeFood(food){

    return {

        id:food.id,

        x:Math.round(food.x*10)/10,

        y:Math.round(food.y*10)/10,

        key:food.key,

        value:food.value

    };

}


/* ============================================================
   NEARBY FOOD
============================================================ */

function getNearbyFoods(player){

    const radius =
        SETTINGS.broadcastRadius;


    return foods

        .filter(food=>{

            return (
                Math.abs(
                    food.x-player.x
                ) <= radius
                &&
                Math.abs(
                    food.y-player.y
                ) <= radius
            );

        })

        .map(
            serializeFood
        );

}


/* ============================================================
   NEARBY PLAYERS
============================================================ */

function getNearbyPlayers(player){

    const radius =
        SETTINGS.broadcastRadius;


    return [...players.values()]

        .filter(other=>{

            if(
                other.id===player.id
            )
                return true;


            /*
            Dead players are not rendered.
            */

            if(!other.alive)
                return false;


            /*
            Shadow players are hidden unless
            the receiving player has radar.
            */

            if(
                other.shadow &&
                player.visionMsLeft<=0
            ){

                return false;

            }


            return (
                Math.abs(
                    other.x-player.x
                )<=radius
                &&
                Math.abs(
                    other.y-player.y
                )<=radius
            );

        })

        .map(
            serializePlayer
        );

}


/* ============================================================
   SEND STATE
============================================================ */

function sendState(player){

    if(
        !player.ws ||
        player.ws.readyState !==
        WebSocket.OPEN
    )
        return;


    const kingSheep =
        getKing("sheep");


    const kingWolf =
        getKing("wolf");


    const message={

        type:"state",


        players:
            getNearbyPlayers(player),


        foods:
            getNearbyFoods(player),


        kingSheepId:
            kingSheep
                ? kingSheep.id
                : null,


        kingWolfId:
            kingWolf
                ? kingWolf.id
                : null,


        leaderboard:
            getLeaderboard()

    };


    try{

        player.ws.send(
            JSON.stringify(message)
        );

    }catch(err){

        console.error(
            "Send state error",
            err
        );

    }

}


/* ============================================================
   BROADCAST
============================================================ */

function broadcastState(){

    for(const player of players.values()){

        sendState(player);

    }

}


/* ============================================================
   CONNECTION
============================================================ */

wss.on("connection",(ws,req)=>{

    if(
        players.size >=
        SETTINGS.maxPlayers
    ){

        ws.close(
            1013,
            "Server full"
        );

        return;

    }


    const player=
        createPlayer(ws);


    console.log(
        `Player connected: ${player.id} (${player.role})`
    );


    /*
    Welcome packet.
    */

    ws.send(
        JSON.stringify({

            type:"welcome",

            id:player.id,

            world:WORLD,

            hungerLimitMs:
                SETTINGS.hungerTime

        })
    );


    /*
    INPUT
    */

    ws.on("message",data=>{

        try{

            const msg=
                JSON.parse(
                    data.toString()
                );


            if(
                msg.type!=="input"
            )
                return;


            /*
            Server-side validation.
            */

            player.input.dx=
                clamp(
                    Number(msg.dx)||0,
                    -1000,
                    1000
                );


            player.input.dy=
                clamp(
                    Number(msg.dy)||0,
                    -1000,
                    1000
                );


            player.input.boost=
                Boolean(
                    msg.boost
                );


        }catch(err){

            console.log(
                "Invalid input packet"
            );

        }

    });


    /*
    Disconnect
    */

    ws.on("close",()=>{

        players.delete(
            player.id
        );


        console.log(
            `Player disconnected: ${player.id}`
        );

    });


    ws.on("error",()=>{

        players.delete(
            player.id
        );

    });

});


/* ============================================================
   MAIN GAME LOOP
============================================================ */

let lastTick=
    Date.now();


setInterval(()=>{

    const now=
        Date.now();


    const dtMs=
        Math.min(
            100,
            now-lastTick
        );


    lastTick=now;


    const dt=
        dtMs/16.6667;


    /*
    UPDATE PLAYERS
    */

    for(const player of players.values()){

        if(!player.alive)
            continue;


        updatePlayerMovement(
            player,
            dt
        );


        updateBoost(
            player,
            dtMs/1000
        );


        updateTimers(
            player,
            dtMs
        );


        updateMagnet(
            player
        );


        eatFood(
            player
        );


        updateBodyLength(
            player
        );

    }


    /*
    COLLISIONS
    */

    checkPlayerCollisions();


},1000/SETTINGS.tickRate);


/* ============================================================
   STATE LOOP
============================================================ */

setInterval(()=>{

    broadcastState();

},1000/SETTINGS.stateRate);


/* ============================================================
   FOOD MAINTENANCE
============================================================ */

setInterval(()=>{

    const missing=
        SETTINGS.maxFood-
        foods.length;


    if(missing<=0)
        return;


    const count=
        Math.min(
            SETTINGS.foodSpawnBatch,
            missing
        );


    for(
        let i=0;
        i<count;
        i++
    ){

        spawnFood();

    }

},1000);


/* ============================================================
   CLEANUP OLD DEAD CONNECTIONS
============================================================ */

setInterval(()=>{

    for(const [id,player] of players){

        if(
            !player.ws ||
            player.ws.readyState ===
            WebSocket.CLOSED
        ){

            players.delete(id);

        }

    }

},10000);


/* ============================================================
   SERVER ERROR HANDLING
============================================================ */

process.on(
    "uncaughtException",
    err=>{

        console.error(
            "UNCAUGHT ERROR:",
            err
        );

    }
);


process.on(
    "unhandledRejection",
    err=>{

        console.error(
            "UNHANDLED REJECTION:",
            err
        );

    }
);
```
