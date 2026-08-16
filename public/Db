// db.js — lightweight persistent user store (JSON file based).
// For a production deploy with real scale, swap this for Postgres/Mongo —
// on most free hosts (including Render's free tier) the filesystem is
// EPHEMERAL, meaning this file can reset on redeploy/restart. Good enough
// for a hobby project / demo; see README for upgrade notes.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');

function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
}
ensureDB();

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  getUser(username) {
    const db = readDB();
    return db.users[username.toLowerCase()] || null;
  },
  createUser(user) {
    const db = readDB();
    db.users[user.username.toLowerCase()] = user;
    writeDB(db);
  },
  updateUser(username, fields) {
    const db = readDB();
    const key = username.toLowerCase();
    if (!db.users[key]) return;
    Object.assign(db.users[key], fields);
    writeDB(db);
  }
};
