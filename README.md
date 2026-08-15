# Flock.io — Live Multiplayer Prototype

This is a **real client-server multiplayer game**, not a demo with bots. The server
(`server.js`) is the single source of truth: it decides who's a sheep or wolf,
runs the 5-minute hunger timer, resolves every kill, and moves every player.
Each browser tab that connects is one real, independent player.

## Run it locally

You need [Node.js](https://nodejs.org) installed (v16 or newer).

```bash
cd flock-io-server
npm install
npm start
```

Then open **http://localhost:3000** in your browser. Open it in a **second tab**
(or a second device on the same network, using your computer's local IP instead
of `localhost`) — you'll see a second player appear and move independently.
That's real multiplayer: two separate connections, one shared world, server-decided
outcomes.

Move your mouse to steer. You'll be assigned sheep or wolf automatically — the
server balances the population toward roughly 70% sheep / 30% wolves, same as
in the design doc. You can't choose your role, and dying reassigns it based on
whatever the population needs at that moment.

## What's real here vs. what's still missing

**Real and working:**
- Authoritative server (all movement, eating, and death decisions happen server-side)
- Population balancer (sheep/wolf ratio enforced on join and respawn)
- Server-side hunger timer for both roles (can't be cheated by pausing the client)
- Live state sync over WebSocket to any number of connected browsers

**Not in this version yet** (see the technical spec for how each of these fits in):
- Accounts/login — everyone is a random guest each time they connect
- Persistent scores/leaderboards across sessions
- Power-ups (shield, magnet, speed drinks, radar) — the 3D demo has these, this
  networked version doesn't yet; they'd need to move into `server.js` the same
  way hunger and eating did
- The nicer 3D visuals from the earlier demo — this client is intentionally
  simple 2D canvas so the *networking* is the thing being tested, not the art
- Multi-region deployment — right now it's one server, one region

## Putting it on the real internet (so people elsewhere can join)

The easiest free option to test with is [Render.com](https://render.com):
1. Push this folder to a GitHub repo
2. On Render, choose "New Web Service," connect the repo
3. Build command: `npm install` — Start command: `npm start`
4. Render gives you a public URL — anyone, anywhere, can now open it and join
   the same live world

This is still one server in one region, so players far from it will feel some
lag — the multi-region piece from the technical spec is the next step after
you've confirmed the core loop works with real people.

## If something breaks

I wrote this without being able to run or test it myself (no internet access
in the environment I built it in), so there's a real chance of a small bug on
first run. If you hit an error, paste the exact message back to me and I'll
fix it directly.
