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
'    .level { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 0.85em; }\n' +
'    a { color: #00ff88; }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <h1>&#128274; MoltLaunch Self-Verify</h1>\n' +
'  <p>Challenge-response verification for AI agents. Three levels, honest labels.</p>\n' +
'\n' +
'  <h2>Verification Levels</h2>\n' +
'  <table>\n' +
'    <tr><th>Level</th><th>Label</th><th>What It Proves</th></tr>\n' +
'    <tr><td><span class="level l0">L0</span></td><td>Registered</td><td>Agent can make HTTP requests. Does NOT prove identity or uniqueness.</td></tr>\n' +
'    <tr><td><span class="level l1">L1</span></td><td>Confirmed</td><td>Agent controls a Colosseum API key (forum challenge-response).</td></tr>\n' +
'    <tr><td><span class="level l2">L2</span></td><td>Verified</td><td>Agent controls a live API endpoint with our verification token.</td></tr>\n' +
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
'    <p><span class="method">POST</span> <code>/api/self-verify/batch</code> &mdash; Batch lookup (L1+ required)</p>\n' +
'    <pre>curl -X POST ' + base + '/api/self-verify/batch \\\n  -H "Content-Type: application/json" \\\n  -d \'{"agentId": "my-agent", "agentIds": ["agent-1", "agent-2"]}\'</pre>\n' +
'  </div>\n' +
'\n' +
'  <h2>Flow</h2>\n' +
'  <ol>\n' +
'    <li>Register &rarr; get challenge code (L0)</li>\n' +
'    <li>Post challenge code on Colosseum forum post #4322 &rarr; confirm (L1)</li>\n' +
'    <li>Place verification token at your API &rarr; verify infrastructure (L2)</li>\n' +
'  </ol>\n' +
'\n' +
'  <p style="color: #666; margin-top: 3rem;">MoltLaunch Self-Verify v1.0 &middot; <a href="https://github.com/tradingstarllc/moltlaunch-verify">Source</a></p>\n' +
'</body>\n' +
'</html>');
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
