# Worm.io Clone

A multiplayer worm/snake arena game inspired by wormate.io — built with Node.js, Express, and Socket.IO on the server, and plain HTML5 Canvas on the client.

## Files
- `server.js` — authoritative game server (movement, collisions, food, leaderboard)
- `public/index.html` — game client (rendering, input, UI)
- `package.json` — dependencies

## Run locally
```bash
npm install
npm start
```
Then open `http://localhost:3000`.

## Deploy on Render
1. Push this folder to a new GitHub repo.
2. On Render: **New +** → **Web Service** → connect your repo.
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. Render sets `PORT` automatically — the server already reads `process.env.PORT`, so no changes needed.
5. Deploy. Once live, open the Render URL and play.

## How it works
- The server owns all game state (worm positions, food, collisions) and broadcasts it ~30 times/sec via Socket.IO.
- Clients only send steering input (mouse angle + boost flag) and render whatever the server sends — this prevents cheating and keeps everyone in sync.
- Move your mouse to steer, hold click or Space to boost (costs length).
- Hitting the world border or another worm's body kills you and turns your body into food.

## Ideas to extend
- Spatial partitioning so the server only sends nearby entities (needed for many concurrent players)
- Skins/customization, mobile joystick controls, sound effects, rooms/regions
