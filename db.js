const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'verify.db');

let db;
let dbReady;

// Initialize async — sql.js loads WASM
function initDb() {
  if (dbReady) return dbReady;
  dbReady = (async () => {
    const SQL = await initSqlJs();
    try {
      const buf = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buf);
    } catch (e) {
      db = new SQL.Database();
    }
    initTables();
    return db;
  })();
  return dbReady;
}

function saveDb() {
  if (!db) return;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function initTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      capabilities TEXT,
      level INTEGER DEFAULT 0,
      level_label TEXT DEFAULT 'registered',
      challenge_code TEXT,
      challenge_token TEXT,
      wallet TEXT,
      code_url TEXT,
      api_endpoint TEXT,
      on_chain_sig TEXT,
      ip_hash TEXT,
      terms_version TEXT,
      terms_accepted_at TEXT,
      registered_at TEXT,
      confirmed_at TEXT,
      verified_at TEXT,
      expires_at TEXT,
      revoked INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sybil_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      signal_type TEXT,
      signal_value TEXT,
      detected_at TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      action TEXT,
      details TEXT,
      ip_hash TEXT,
      created_at TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS pending_anchors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      memo TEXT,
      created_at TEXT,
      retries INTEGER DEFAULT 0
    )
  `);
  saveDb();
}

// Helper: run a SELECT and return array of objects
function allRows(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function oneRow(sql, params = []) {
  const rows = allRows(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// --- IP Hashing ---
function getDailySalt() {
  const day = new Date().toISOString().slice(0, 10);
  return `molt-verify-salt-${day}`;
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(ip + getDailySalt()).digest('hex');
}

// --- Agent Queries ---
function getAgent(id) {
  return oneRow('SELECT * FROM agents WHERE id = ?', [id]);
}

function createAgent({ id, name, description, capabilities, challengeCode, ipHash, termsVersion }) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.run(`
    INSERT INTO agents (id, name, description, capabilities, level, level_label, challenge_code, ip_hash, terms_version, terms_accepted_at, registered_at, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, 'registered', ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, name || null, description || null, capabilities ? JSON.stringify(capabilities) : null,
    challengeCode, ipHash, termsVersion, now, now, expiresAt, now, now]);
  saveDb();
}

function confirmAgent(id, challengeToken) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.run(`
    UPDATE agents SET level = 1, level_label = 'confirmed', challenge_token = ?, confirmed_at = ?, expires_at = ?, updated_at = ?
    WHERE id = ?
  `, [challengeToken, now, expiresAt, now, id]);
  saveDb();
}

function verifyAgent(id, { apiEndpoint, codeUrl, onChainSig }) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.run(`
    UPDATE agents SET level = 2, level_label = 'verified', api_endpoint = ?, code_url = ?, on_chain_sig = ?, verified_at = ?, expires_at = ?, updated_at = ?
    WHERE id = ?
  `, [apiEndpoint, codeUrl, onChainSig || null, now, expiresAt, now, id]);
  saveDb();
}

function updateOnChainSig(id, sig) {
  db.run('UPDATE agents SET on_chain_sig = ?, updated_at = ? WHERE id = ?', [sig, new Date().toISOString(), id]);
  saveDb();
}

function getAllAgents() {
  return allRows('SELECT * FROM agents');
}

function getAgentsByIds(ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return allRows(`SELECT * FROM agents WHERE id IN (${placeholders})`, ids);
}

function countRegistrationsFromIp(ipHash) {
  const today = new Date().toISOString().slice(0, 10);
  const row = oneRow(
    'SELECT COUNT(*) as cnt FROM agents WHERE ip_hash = ? AND registered_at >= ?',
    [ipHash, today + 'T00:00:00.000Z']
  );
  return row ? row.cnt : 0;
}

// --- Audit Log ---
function addAuditLog(agentId, action, details, ipHash) {
  db.run(
    'INSERT INTO audit_log (agent_id, action, details, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    [agentId, action, JSON.stringify(details), ipHash, new Date().toISOString()]
  );
  saveDb();
}

// --- Sybil Signals ---
function addSybilSignal(agentId, signalType, signalValue) {
  db.run(
    'INSERT INTO sybil_signals (agent_id, signal_type, signal_value, detected_at) VALUES (?, ?, ?, ?)',
    [agentId, signalType, signalValue, new Date().toISOString()]
  );
  saveDb();
}

function getSybilSignals(agentId) {
  return allRows('SELECT * FROM sybil_signals WHERE agent_id = ?', [agentId]);
}

// --- Pending Anchors ---
function addPendingAnchor(agentId, memo) {
  db.run('INSERT INTO pending_anchors (agent_id, memo, created_at) VALUES (?, ?, ?)',
    [agentId, memo, new Date().toISOString()]);
  saveDb();
}

function getPendingAnchors() {
  return allRows('SELECT * FROM pending_anchors WHERE retries < 5');
}

function removePendingAnchor(id) {
  db.run('DELETE FROM pending_anchors WHERE id = ?', [id]);
  saveDb();
}

function incrementPendingAnchorRetry(id) {
  db.run('UPDATE pending_anchors SET retries = retries + 1 WHERE id = ?', [id]);
  saveDb();
}

// --- Full Dump ---
function fullDump() {
  return {
    agents: allRows('SELECT * FROM agents'),
    sybil_signals: allRows('SELECT * FROM sybil_signals'),
    audit_log: allRows('SELECT * FROM audit_log'),
    pending_anchors: allRows('SELECT * FROM pending_anchors'),
    exported_at: new Date().toISOString()
  };
}

function getDbPath() {
  return DB_PATH;
}

module.exports = {
  initDb,
  hashIp,
  getAgent,
  createAgent,
  confirmAgent,
  verifyAgent,
  updateOnChainSig,
  getAllAgents,
  getAgentsByIds,
  countRegistrationsFromIp,
  addAuditLog,
  addSybilSignal,
  getSybilSignals,
  addPendingAnchor,
  getPendingAnchors,
  removePendingAnchor,
  incrementPendingAnchorRetry,
  fullDump,
  getDbPath
};
