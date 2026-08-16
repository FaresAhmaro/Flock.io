// db.js — lightweight persistent user store (JSON file based), with a
// safe in-memory fallback if the filesystem isn't writable (common on
// some serverless/read-only hosts). This means the game NEVER crashes
// because of storage — worst case, accounts just don't persist across
// restarts and you'll see a warning in the server logs.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');

let usingMemoryFallback = false;
let memoryDB = { users: {} };

function ensureDB() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
    // verify we can actually write, not just that the file exists
    fs.accessSync(DB_FILE, fs.constants.W_OK);
  } catch (err) {
    usingMemoryFallback = true;
    console.warn('[db.js] WARNING: filesystem is not writable, falling back to in-memory storage.');
    console.warn('[db.js] Accounts will NOT persist across server restarts until this is fixed.');
    console.warn('[db.js] Underlying error:', err.message);
  }
}
ensureDB();

function readDB() {
  if (usingMemoryFallback) return memoryDB;
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    console.error('[db.js] Failed to read DB file, using empty DB this call:', err.message);
    return { users: {} };
  }
}

function writeDB(data) {
  if (usingMemoryFallback) { memoryDB = data; return; }
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[db.js] Failed to write DB file, switching to in-memory fallback:', err.message);
    usingMemoryFallback = true;
    memoryDB = data;
  }
}

module.exports = {
  isUsingMemoryFallback() { return usingMemoryFallback; },
  getUser(username) {
    if (!username) return null;
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
