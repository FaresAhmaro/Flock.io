# Worm.io Clone — v2 (Bots, Power-ups, Accounts, Cosmetics)

A multiplayer worm/snake arena game inspired by wormate.io, built with Node.js + Express + Socket.IO on the server and HTML5 Canvas on the client.

## Files
- `server.js` — authoritative game server
- `db.js` — simple JSON-file user datastore (accounts, high score, gold, cosmetics)
- `public/index.html` — game client
- `package.json` — dependencies (`express`, `socket.io`, `bcryptjs`)

## Features implemented
- **Bots**: 45 AI-controlled worms roam the arena, hunt food, avoid edges, and respawn after dying, so the arena always feels populated.
- **Emoji foods**: sushi 🍣, burger 🍔, pizza 🍕, donut 🍩, apple 🍎, and more spawn as normal food.
- **Power-ups** (rare spawns): ⚡ Speed boost (8s), 🛡️ Invincibility (5 min — bypasses all collisions and edge-death), 📡 Radar (15s — shows arrows pointing to the 5 nearest players), 💰 Gold (adds to your persistent gold balance + bonus growth).
- **Collisions**: touching another worm's **body** kills you; touching another worm's **head-on** (face to face) kills **both** of you. Dying always drops your body as food for others.
- **Accounts**: register/login (passwords hashed with bcrypt), your **high score and gold persist** across sessions and logins.
- **Cosmetics**: pick a skin color or a flag-striped pattern, plus a wearable accessory emoji (👑🎩😎🦸🐰👻🥳😇) — saved to your account.
- **Scaling optimizations**: a spatial grid is used for food/collision lookups, and each client is only sent worms/food near their own worm (not the whole world), which lets the server support far more entities than sending everything to everyone.

## Run locally
```bash
npm install
npm start
```
Open `http://localhost:3000`.

## Deploy on Render
1. Push this folder to a GitHub repo (keep `index.html` inside `public/`).
2. Render → New → Web Service → connect the repo.
3. Build command: `npm install` · Start command: `npm start`.
4. Server reads `process.env.PORT` automatically — no config changes needed.

## Important honesty note: "thousands of players in one arena"
This is the one ask I couldn't deliver literally, and I want to be upfront about why rather than pretend otherwise. A single Node.js process on a free-tier server realistically handles **dozens to a few hundred** concurrent real players smoothly, not thousands, even with the optimizations above. Getting to wormate.io's scale requires:
- A real hosted database (Postgres/Mongo) instead of the JSON file `db.js` uses (which also **resets on redeploy on most free hosts** — fine for a demo, not for production)
- Multiple game server instances behind a load balancer, each running its own "region"/shard of the arena
- A dedicated game-loop architecture tuned in a lower-level language or with heavy binary-protocol optimization (most real .io games use compact binary state updates, not JSON)

What I *did* build to help: bots to make the arena feel full, spatial partitioning so only nearby entities are networked to each client, and a design where adding more bots or players degrades gracefully rather than falling over immediately. If you outgrow a single instance, that's the point to bring in a real database + horizontal scaling.

## Ideas to extend further
- Mobile touch/joystick controls
- Gold shop to unlock premium skins
- Regional sharding for true large-scale arenas
- Sound effects and death animations
