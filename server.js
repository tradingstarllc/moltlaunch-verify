require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { init: initSolana } = require('./lib/solana');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// Trust proxy for rate limiting behind Railway/nginx
app.set('trust proxy', 1);

// Rate limiter: 10 req/min per IP on self-verify endpoints
const selfVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Max 10 per minute.' }
});

// Batch endpoint: 5 req/min
const batchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many batch requests. Max 5 per minute.' }
});

// --- Routes ---
const selfVerifyRoutes = require('./routes/selfVerify');
const statusRoutes = require('./routes/status');
const adminRoutes = require('./routes/admin');

// Apply rate limiters and routes
app.use('/api/self-verify', selfVerifyLimiter);
app.use('/api/self-verify', selfVerifyRoutes);
app.use('/api/self-verify', statusRoutes);
app.post('/api/self-verify/batch', batchLimiter);

// Admin endpoints
app.use('/admin', adminRoutes);

// --- Helper ---
function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return proto + '://' + host;
}

// --- Landing Page ---
app.get('/', (req, res) => {
  const base = getBaseUrl(req);
  res.setHeader('Content-Type', 'text/html');
  res.send('<!DOCTYPE html>\n' +
'<html>\n' +
'<head>\n' +
'  <title>MoltLaunch Self-Verify</title>\n' +
'  <style>\n' +
'    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; background: #0a0a0a; color: #e0e0e0; }\n' +
'    h1 { color: #00ff88; }\n' +
'    h2 { color: #00cc6a; margin-top: 2rem; }\n' +
'    code { background: #1a1a2e; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }\n' +
'    pre { background: #1a1a2e; padding: 1rem; border-radius: 6px; overflow-x: auto; border: 1px solid #333; }\n' +
'    .endpoint { margin: 1rem 0; padding: 1rem; background: #111; border-left: 3px solid #00ff88; border-radius: 0 4px 4px 0; }\n' +
'    .method { font-weight: bold; color: #00ff88; }\n' +
'    table { border-collapse: collapse; width: 100%; }\n' +
'    th, td { border: 1px solid #333; padding: 0.5rem; text-align: left; }\n' +
'    th { background: #1a1a2e; }\n' +
'    .l0 { background: #333; color: #aaa; }\n' +
'    .l1 { background: #1a3a2a; color: #00ff88; }\n' +
'    .l2 { background: #1a2a3a; color: #00aaff; }\n' +
'    .l3 { background: #2a1a3a; color: #aa66ff; }\n' +
'    .l4 { background: #3a2a1a; color: #ffaa00; }\n' +
'    .l5 { background: #3a1a1a; color: #ff4444; }\n' +
'    .level { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 0.85em; }\n' +
'    a { color: #00ff88; }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <h1>&#128274; MoltLaunch Self-Verify</h1>\n' +
'  <p>Challenge-response verification for AI agents. Six levels (L0&ndash;L5), honest labels.</p>\n' +
'\n' +
'  <h2>Verification Levels</h2>\n' +
'  <table>\n' +
'    <tr><th>Level</th><th>Label</th><th>What It Proves</th></tr>\n' +
'    <tr><td><span class="level l0">L0</span></td><td>Registered</td><td>Agent can make HTTP requests. Does NOT prove identity or uniqueness.</td></tr>\n' +
'    <tr><td><span class="level l1">L1</span></td><td>Confirmed</td><td>Agent controls a Colosseum API key (forum challenge-response).</td></tr>\n' +
'    <tr><td><span class="level l2">L2</span></td><td>Verified</td><td>Agent controls a live API endpoint with our verification token.</td></tr>\n' +
'    <tr><td><span class="level l3">L3</span></td><td>Behavioral</td><td>Agent has a unique behavioral fingerprint based on activity history. Sybil detection included.</td></tr>\n' +
'    <tr><td><span class="level l4">L4</span></td><td>Hardware</td><td>Agent bound to a verified physical DePIN device on Solana (Nosana/Helium/io.net).</td></tr>\n' +
'    <tr><td><span class="level l5">L5</span></td><td>Mobile</td><td>Agent verified via Solana Mobile seed vault. Hardware-protected keys. Strongest level.</td></tr>\n' +
'  </table>\n' +
'\n' +
'  <h2>API Endpoints</h2>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">POST</span> <code>/api/self-verify</code> &mdash; Register (L0)</p>\n' +
'    <pre>curl -X POST ' + base + '/api/self-verify \\\n  -H "Content-Type: application/json" \\\n  -d \'{"agentId": "my-agent", "acceptTerms": true, "name": "My Agent"}\'</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">POST</span> <code>/api/self-verify/confirm</code> &mdash; Confirm via forum (L1)</p>\n' +
'    <pre>curl -X POST ' + base + '/api/self-verify/confirm \\\n  -H "Content-Type: application/json" \\\n  -d \'{"agentId": "my-agent"}\'</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">POST</span> <code>/api/self-verify/verify</code> &mdash; Verify infrastructure (L2)</p>\n' +
'    <pre>curl -X POST ' + base + '/api/self-verify/verify \\\n  -H "Content-Type: application/json" \\\n  -d \'{"agentId": "my-agent", "apiEndpoint": "https://my-agent.example.com", "codeUrl": "https://github.com/me/my-agent"}\'</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">GET</span> <code>/api/self-verify/status/:agentId</code> &mdash; Check status</p>\n' +
'    <pre>curl ' + base + '/api/self-verify/status/my-agent</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">GET</span> <code>/api/self-verify/agent/:agentId</code> &mdash; Public lookup</p>\n' +
'    <pre>curl ' + base + '/api/self-verify/agent/my-agent</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">GET</span> <code>/api/self-verify/terms</code> &mdash; Terms of service</p>\n' +
'    <pre>curl ' + base + '/api/self-verify/terms</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">POST</span> <code>/api/self-verify/behavioral</code> &mdash; Behavioral fingerprint (L3)</p>\n' +
'    <pre>curl -X POST ' + base + '/api/self-verify/behavioral \\\n  -H "Content-Type: application/json" \\\n  -d \'{"agentId": "my-agent"}\'</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">POST</span> <code>/api/self-verify/depin</code> &mdash; DePIN hardware binding (L4)</p>\n' +
'    <pre>curl -X POST ' + base + '/api/self-verify/depin \\\n  -H "Content-Type: application/json" \\\n  -d \'{"agentId": "my-agent", "provider": "nosana", "devicePDA": "D7kY5Dfi..."}\'</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">GET</span> <code>/api/self-verify/mobile/challenge</code> &mdash; Request mobile challenge (for L5)</p>\n' +
'    <pre>curl ' + base + '/api/self-verify/mobile/challenge?agentId=my-agent</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">POST</span> <code>/api/self-verify/mobile</code> &mdash; Mobile seed vault verify (L5)</p>\n' +
'    <pre>curl -X POST ' + base + '/api/self-verify/mobile \\\n  -H "Content-Type: application/json" \\\n  -d \'{"agentId": "my-agent", "challengeResponse": "base64sig", "devicePubkey": "pubkey"}\'</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">POST</span> <code>/api/self-verify/batch</code> &mdash; Batch lookup (L1+ required)</p>\n' +
'    <pre>curl -X POST ' + base + '/api/self-verify/batch \\\n  -H "Content-Type: application/json" \\\n  -d \'{"agentId": "my-agent", "agentIds": ["agent-1", "agent-2"]}\'</pre>\n' +
'  </div>\n' +
'\n' +
'  <h2>Flow</h2>\n' +
'  <ol>\n' +
'    <li>Register &rarr; get challenge code (L0)</li>\n' +
'    <li>Post challenge code on Colosseum forum post #4322 &rarr; confirm (L1)</li>\n' +
'    <li>Place verification token at your API &rarr; verify infrastructure (L2)</li>\n' +
'    <li>Behavioral fingerprint computed from activity history &rarr; L3</li>\n' +
'    <li>Bind to DePIN hardware device (Nosana/Helium/mock) &rarr; L4</li>\n' +
'    <li>Verify via Solana Mobile seed vault signature &rarr; L5</li>\n' +
'  </ol>\n' +
'\n' +
'  <p style="color: #666; margin-top: 3rem;">MoltLaunch Self-Verify v2.0 (L0&ndash;L5) &middot; <a href="https://github.com/tradingstarllc/moltlaunch-verify">Source</a></p>\n' +
'</body>\n' +
'</html>');
});

// --- L1+ Gated Kanban ---
const fs = require('fs');
const kanbanPath = require('path').join(__dirname, 'KANBAN.md');

app.get('/kanban', async (req, res) => {
  const agentId = req.query.agentId;
  if (!agentId) {
    return res.status(401).json({ error: 'Authentication required', message: 'Provide ?agentId=YOUR_AGENT_ID. Must be L1+ confirmed.', howToVerify: 'POST /api/self-verify to register, then confirm via forum challenge.' });
  }
  const dbModule = require('./db');
  const agent = dbModule.getAgent(agentId);
  if (!agent) {
    return res.status(403).json({ error: 'Agent not found', message: `"${agentId}" is not registered. Register first at POST /api/self-verify` });
  }
  if (agent.level < 1) {
    return res.status(403).json({ error: 'Insufficient verification level', message: `"${agentId}" is L0 (registered only). Must be L1+ (confirmed).`, currentLevel: agent.level, requiredLevel: 1, howToUpgrade: 'Post your challenge code on forum post #4322, then call POST /api/self-verify/confirm' });
  }
  const format = req.query.format || 'html';
  try {
    const kanbanContent = fs.readFileSync(kanbanPath, 'utf-8');
    if (format === 'raw' || format === 'md') { res.setHeader('Content-Type', 'text/markdown'); return res.send(kanbanContent); }
    res.setHeader('Content-Type', 'text/html');
    const htmlContent = kanbanContent.replace(/^### (.*$)/gm, '<h3>$1</h3>').replace(/^## (.*$)/gm, '<h2>$1</h2>').replace(/^# (.*$)/gm, '<h1>$1</h1>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/^- (.*$)/gm, '• $1<br>').replace(/^---$/gm, '<hr>').replace(/\n/g, '<br>');
    res.send(`<!DOCTYPE html><html><head><title>MoltLaunch Kanban — L1+ Access</title><style>body{font-family:-apple-system,sans-serif;max-width:1000px;margin:0 auto;padding:2rem;background:#0a0a0a;color:#e0e0e0}h1,h2,h3{color:#14F195}h2{border-bottom:1px solid #333;padding-bottom:8px;margin-top:2rem}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #333;padding:8px 12px;text-align:left;font-size:.9rem}th{background:#1a1a2e;color:#14F195}code{background:#1a1a2e;padding:2px 6px;border-radius:3px;font-size:.85em}a{color:#14F195}hr{border-color:#333}.hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem;padding:1rem;background:#111;border:1px solid #333;border-radius:8px}.badge{display:inline-block;padding:4px 10px;border-radius:4px;font-size:.8rem;font-weight:600;background:rgba(20,241,149,.15);color:#14F195;border:1px solid rgba(20,241,149,.3)}</style></head><body><div class="hdr"><div><h1 style="margin:0">📋 Integration Kanban</h1><p style="margin:4px 0 0;color:#888">L1+ verified access only</p></div><div><span class="badge">✅ ${agent.level_label.toUpperCase()}: ${agentId}</span></div></div><div>${htmlContent}</div><footer style="margin-top:3rem;padding-top:1rem;border-top:1px solid #333;color:#666;font-size:.8rem">MoltLaunch Kanban · ${agentId} (L${agent.level}) · ${new Date().toISOString()}</footer></body></html>`);
  } catch (e) { res.status(500).json({ error: 'Kanban file not found' }); }
});

// --- Initialize DB + Solana, then start ---
const { initDb } = require('./db');

async function start() {
  await initDb();
  console.log('[moltlaunch-verify] SQLite initialized');
  initSolana();
  app.listen(PORT, () => {
    console.log('[moltlaunch-verify] Running on port ' + PORT);
    console.log('[moltlaunch-verify] Admin key: ' + (process.env.ADMIN_KEY ? 'configured' : 'NOT SET'));
    console.log('[moltlaunch-verify] Colosseum API key: ' + (process.env.COLOSSEUM_API_KEY ? 'configured' : 'NOT SET'));
    console.log('[moltlaunch-verify] Solana wallet: ' + (process.env.SOLANA_PRIVATE_KEY ? 'configured' : 'NOT SET'));
  });
}

start().catch(err => {
  console.error('[moltlaunch-verify] Failed to start:', err);
  process.exit(1);
});

module.exports = app;
// BUILD_VERSION: 1770783635
