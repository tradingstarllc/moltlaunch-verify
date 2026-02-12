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
'  <meta charset="utf-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'  <title>proveyour.id — Agent Trust Verification</title>\n' +
'  <style>\n' +
'    *, *::before, *::after { box-sizing: border-box; }\n' +
'    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 0 auto; padding: 2rem; background: #0a0a0a; color: #e0e0e0; line-height: 1.6; }\n' +
'    h1 { color: #00ff88; font-size: 2rem; margin-bottom: 0.25rem; }\n' +
'    h2 { color: #00cc6a; margin-top: 2.5rem; margin-bottom: 1rem; border-bottom: 1px solid #222; padding-bottom: 0.5rem; }\n' +
'    h3 { color: #00ff88; margin-top: 1.5rem; margin-bottom: 0.5rem; font-size: 1rem; }\n' +
'    code { background: #1a1a2e; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }\n' +
'    pre { background: #1a1a2e; padding: 1rem; border-radius: 6px; overflow-x: auto; border: 1px solid #333; font-size: 0.85em; }\n' +
'    a { color: #00ff88; text-decoration: none; }\n' +
'    a:hover { text-decoration: underline; }\n' +
'    .tagline { color: #aaa; font-size: 1.1rem; margin-top: 0; margin-bottom: 2rem; }\n' +
'    .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin: 1.5rem 0; }\n' +
'    .step { background: #111; border: 1px solid #222; border-radius: 8px; padding: 1.25rem; }\n' +
'    .step-num { display: inline-block; background: #00ff88; color: #000; font-weight: 700; width: 28px; height: 28px; text-align: center; line-height: 28px; border-radius: 50%; margin-bottom: 0.5rem; font-size: 0.9rem; }\n' +
'    .step-title { color: #00ff88; font-weight: 600; margin-bottom: 0.25rem; }\n' +
'    .step p { color: #bbb; font-size: 0.9rem; margin: 0; }\n' +
'    .signals { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; margin: 1rem 0; }\n' +
'    .signal { background: #111; border: 1px solid #222; border-radius: 6px; padding: 1rem; }\n' +
'    .signal-name { color: #00ff88; font-family: monospace; font-weight: 600; font-size: 0.95rem; margin-bottom: 0.25rem; }\n' +
'    .signal-desc { color: #bbb; font-size: 0.85rem; margin: 0; }\n' +
'    .signal-range { color: #666; font-size: 0.8rem; margin-top: 0.25rem; }\n' +
'    .endpoint { margin: 0.75rem 0; padding: 1rem; background: #111; border-left: 3px solid #00ff88; border-radius: 0 4px 4px 0; }\n' +
'    .method { font-weight: bold; color: #00ff88; }\n' +
'    .endpoint-desc { color: #bbb; font-size: 0.9rem; }\n' +
'    .onchain { background: #111; border: 1px solid #222; border-radius: 8px; padding: 1.25rem; margin: 1rem 0; }\n' +
'    .onchain-label { color: #666; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }\n' +
'    .onchain-value { font-family: monospace; font-size: 0.9rem; word-break: break-all; }\n' +
'    .links { display: flex; flex-wrap: wrap; gap: 0.75rem 1.5rem; margin: 1rem 0; }\n' +
'    .links a { padding: 0.4rem 0.8rem; background: #111; border: 1px solid #222; border-radius: 4px; font-size: 0.9rem; transition: border-color 0.2s; }\n' +
'    .links a:hover { border-color: #00ff88; text-decoration: none; }\n' +
'    .arch-note { background: #0d1a14; border: 1px solid #1a3a2a; border-radius: 6px; padding: 1rem 1.25rem; margin: 1.5rem 0; color: #aaa; font-size: 0.9rem; }\n' +
'    .arch-note strong { color: #00cc6a; }\n' +
'    footer { color: #444; margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #1a1a1a; font-size: 0.85rem; }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <h1>&#128274; proveyour.id</h1>\n' +
'  <p class="tagline">Composable trust signals for AI agents on Solana.<br>We verify infrastructure. Protocols decide what &ldquo;trusted&rdquo; means.</p>\n' +
'\n' +
'  <h2>How It Works</h2>\n' +
'  <div class="steps">\n' +
'    <div class="step">\n' +
'      <div class="step-num">1</div>\n' +
'      <div class="step-title">Register</div>\n' +
'      <p>Agent creates an AgentIdentity PDA on devnet.</p>\n' +
'    </div>\n' +
'    <div class="step">\n' +
'      <div class="step-num">2</div>\n' +
'      <div class="step-title">Verify</div>\n' +
'      <p>Our engine runs infrastructure checks &mdash; API challenge-response, environment detection.</p>\n' +
'    </div>\n' +
'    <div class="step">\n' +
'      <div class="step-num">3</div>\n' +
'      <div class="step-title">Attest</div>\n' +
'      <p>Verification results written as composable signals: <code>infra_type</code>, <code>economic_stake</code>, <code>hardware_binding</code>.</p>\n' +
'    </div>\n' +
'  </div>\n' +
'\n' +
'  <h2>Signal Types</h2>\n' +
'  <div class="signals">\n' +
'    <div class="signal">\n' +
'      <div class="signal-name">infra_type</div>\n' +
'      <p class="signal-desc">Infrastructure classification</p>\n' +
'      <p class="signal-range">Unknown &rarr; Cloud &rarr; TEE &rarr; DePIN</p>\n' +
'    </div>\n' +
'    <div class="signal">\n' +
'      <div class="signal-name">has_economic_stake</div>\n' +
'      <p class="signal-desc">SOL or tokens at risk</p>\n' +
'      <p class="signal-range">boolean</p>\n' +
'    </div>\n' +
'    <div class="signal">\n' +
'      <div class="signal-name">has_hardware_binding</div>\n' +
'      <p class="signal-desc">TPM / SGX attested hardware</p>\n' +
'      <p class="signal-range">boolean</p>\n' +
'    </div>\n' +
'    <div class="signal">\n' +
'      <div class="signal-name">trust_score</div>\n' +
'      <p class="signal-desc">Derived from all signals</p>\n' +
'      <p class="signal-range">0 &ndash; 100</p>\n' +
'    </div>\n' +
'  </div>\n' +
'\n' +
'  <h2>API Endpoints</h2>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">POST</span> <code>/api/self-verify</code></p>\n' +
'    <p class="endpoint-desc">Register agent &mdash; creates identity PDA, returns challenge token.</p>\n' +
'    <pre>curl -X POST ' + base + '/api/self-verify \\\n  -H "Content-Type: application/json" \\\n  -d \'{"agentId": "my-agent", "acceptTerms": true, "name": "My Agent"}\'</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">POST</span> <code>/api/self-verify/confirm</code></p>\n' +
'    <p class="endpoint-desc">Confirm identity via challenge-response.</p>\n' +
'    <pre>curl -X POST ' + base + '/api/self-verify/confirm \\\n  -H "Content-Type: application/json" \\\n  -d \'{"agentId": "my-agent"}\'</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">POST</span> <code>/api/self-verify/verify</code></p>\n' +
'    <p class="endpoint-desc">Verify infrastructure &mdash; runs environment detection, writes composable signals on-chain.</p>\n' +
'    <pre>curl -X POST ' + base + '/api/self-verify/verify \\\n  -H "Content-Type: application/json" \\\n  -d \'{"agentId": "my-agent", "apiEndpoint": "https://my-agent.example.com"}\'</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">GET</span> <code>/api/self-verify/agent/:id</code></p>\n' +
'    <p class="endpoint-desc">Public agent lookup &mdash; returns identity, signals, and trust score.</p>\n' +
'    <pre>curl ' + base + '/api/self-verify/agent/my-agent</pre>\n' +
'  </div>\n' +
'\n' +
'  <div class="endpoint">\n' +
'    <p><span class="method">GET</span> <code>/api/self-verify/terms</code></p>\n' +
'    <p class="endpoint-desc">Current terms of service and verification policy.</p>\n' +
'    <pre>curl ' + base + '/api/self-verify/terms</pre>\n' +
'  </div>\n' +
'\n' +
'  <h2>On-Chain Program</h2>\n' +
'  <div class="onchain">\n' +
'    <div class="onchain-label">Program (devnet)</div>\n' +
'    <div class="onchain-value"><code>6AZSAhq4iJTwCfGEVssoa1p3GnBqGkbcQ1iDdP1U1pSb</code></div>\n' +
'  </div>\n' +
'  <div class="onchain">\n' +
'    <div class="onchain-label">SDK</div>\n' +
'    <div class="onchain-value"><code>npm install @moltlaunch/sdk</code> &nbsp; v3.0.0</div>\n' +
'  </div>\n' +
'\n' +
'  <h2>Links</h2>\n' +
'  <div class="links">\n' +
'    <a href="https://youragent.id">Website</a>\n' +
'    <a href="https://youragent.id/demo.html">Demo</a>\n' +
'    <a href="https://youragent.id/blog.html">Blog</a>\n' +
'    <a href="https://github.com/solana-foundation/SRFCs/discussions/9">sRFC #9</a>\n' +
'    <a href="https://github.com/tradingstarllc/moltlaunch">GitHub</a>\n' +
'  </div>\n' +
'\n' +
'  <div class="arch-note">\n' +
'    <strong>Architecture:</strong> Built as a SAS (Solana Attestation Service) issuer. Migration to SAS mainnet planned. Currently running custom Anchor program on devnet.\n' +
'  </div>\n' +
'\n' +
'  <footer>proveyour.id &mdash; V3 Composable Signal Architecture &middot; <a href="https://github.com/tradingstarllc/moltlaunch">Source</a></footer>\n' +
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

// --- Well-known for self-verification (DYNAMIC from DB) ---
app.get("/.well-known/moltlaunch.json", async (req, res) => {
  try {
    const dbModule = require("./db");
    const agent = dbModule.getAgent("moltlaunch-agent");
    if (agent && agent.challenge_token) {
      res.json({ agentId: agent.id, token: agent.challenge_token });
    } else {
      res.status(404).json({ error: "No agent token found" });
    }
  } catch (e) {
    res.status(500).json({ error: "Database not ready" });
  }
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
