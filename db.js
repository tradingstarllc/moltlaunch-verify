const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'verify.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sybil_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT REFERENCES agents(id),
      signal_type TEXT,
      signal_value TEXT,
      detected_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      action TEXT,
      details TEXT,
      ip_hash TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pending_anchors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      memo TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      retries INTEGER DEFAULT 0
    );
  `);
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
  return getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id);
}

function createAgent({ id, name, description, capabilities, challengeCode, ipHash, termsVersion }) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare(`
    INSERT INTO agents (id, name, description, capabilities, level, level_label, challenge_code, ip_hash, terms_version, terms_accepted_at, registered_at, expires_at)
    VALUES (?, ?, ?, ?, 0, 'registered', ?, ?, ?, ?, ?, ?)
  `).run(id, name || null, description || null, capabilities ? JSON.stringify(capabilities) : null,
    challengeCode, ipHash, termsVersion, now, now, expiresAt);
}

function confirmAgent(id, challengeToken) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare(`
    UPDATE agents SET level = 1, level_label = 'confirmed', challenge_token = ?, confirmed_at = ?, expires_at = ?, updated_at = ?
    WHERE id = ?
  `).run(challengeToken, now, expiresAt, now, id);
}

function verifyAgent(id, { apiEndpoint, codeUrl, onChainSig }) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare(`
    UPDATE agents SET level = 2, level_label = 'verified', api_endpoint = ?, code_url = ?, on_chain_sig = ?, verified_at = ?, expires_at = ?, updated_at = ?
    WHERE id = ?
  `).run(apiEndpoint, codeUrl, onChainSig || null, now, expiresAt, now, id);
}

function updateOnChainSig(id, sig) {
  getDb().prepare('UPDATE agents SET on_chain_sig = ?, updated_at = datetime("now") WHERE id = ?').run(sig, id);
}

function getAllAgents() {
  return getDb().prepare('SELECT * FROM agents').all();
}

function getAgentsByIds(ids) {
  const placeholders = ids.map(() => '?').join(',');
  return getDb().prepare(`SELECT * FROM agents WHERE id IN (${placeholders})`).all(...ids);
}

function countRegistrationsFromIp(ipHash) {
  const today = new Date().toISOString().slice(0, 10);
  return getDb().prepare(
    `SELECT COUNT(*) as cnt FROM agents WHERE ip_hash = ? AND registered_at >= ?`
  ).get(ipHash, today + 'T00:00:00.000Z').cnt;
}

// --- Audit Log ---
function addAuditLog(agentId, action, details, ipHash) {
  getDb().prepare(
    'INSERT INTO audit_log (agent_id, action, details, ip_hash) VALUES (?, ?, ?, ?)'
  ).run(agentId, action, JSON.stringify(details), ipHash);
}

// --- Sybil Signals ---
function addSybilSignal(agentId, signalType, signalValue) {
  getDb().prepare(
    'INSERT INTO sybil_signals (agent_id, signal_type, signal_value) VALUES (?, ?, ?)'
  ).run(agentId, signalType, signalValue);
}

function getSybilSignals(agentId) {
  return getDb().prepare('SELECT * FROM sybil_signals WHERE agent_id = ?').all(agentId);
}

// --- Pending Anchors ---
function addPendingAnchor(agentId, memo) {
  getDb().prepare('INSERT INTO pending_anchors (agent_id, memo) VALUES (?, ?)').run(agentId, memo);
}

function getPendingAnchors() {
  return getDb().prepare('SELECT * FROM pending_anchors WHERE retries < 5').all();
}

function removePendingAnchor(id) {
  getDb().prepare('DELETE FROM pending_anchors WHERE id = ?').run(id);
}

function incrementPendingAnchorRetry(id) {
  getDb().prepare('UPDATE pending_anchors SET retries = retries + 1 WHERE id = ?').run(id);
}

// --- Full Dump ---
function fullDump() {
  return {
    agents: getDb().prepare('SELECT * FROM agents').all(),
    sybil_signals: getDb().prepare('SELECT * FROM sybil_signals').all(),
    audit_log: getDb().prepare('SELECT * FROM audit_log').all(),
    pending_anchors: getDb().prepare('SELECT * FROM pending_anchors').all(),
    exported_at: new Date().toISOString()
  };
}

function getDbPath() {
  return DB_PATH;
}

module.exports = {
  getDb,
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
