const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateChallengeCode, generateChallengeToken } = require('../lib/challenges');
const { verifyChallengeOnForum, fetchUrl } = require('../lib/colosseum');
const { anchorLevelChange, buildMemo } = require('../lib/solana');

const LEVEL_DESCRIPTIONS = {
  0: 'Agent registered on MoltLaunch. Proves ability to make HTTP requests. Does NOT prove identity or uniqueness.',
  1: 'Agent confirmed identity via Colosseum forum challenge. Proves agent controls a Colosseum API key.',
  2: 'Agent verified infrastructure. Proves agent controls a live API endpoint with our verification token.'
};

const LEVEL_LABELS = { 0: 'registered', 1: 'confirmed', 2: 'verified' };

const TERMS_TEXT = `MoltLaunch Self-Verify Terms of Service (v1.0)

1. Verification is a signal, not a warranty. A verified agent can still misbehave.
2. Levels indicate what was checked, not trustworthiness.
3. L0 proves you can call an API. L1 proves you control a Colosseum API key. L2 proves you control an API endpoint.
4. Verification expires after 30 days and must be renewed.
5. MoltLaunch may revoke verification at any time for any reason.
6. Data collected: agentId, name, description, capabilities (provided by you), IP hash (SHA256, daily rotation), timestamps.
7. On-chain anchoring: L1+ verifications are recorded on Solana devnet via Memo program.
8. No verification level implies endorsement by MoltLaunch.`;

const TERMS_VERSION = 'v1.0';

/**
 * POST /api/self-verify — Register (L0)
 */
router.post('/', (req, res) => {
  try {
    const { agentId, acceptTerms, name, description, capabilities } = req.body;

    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({ error: 'agentId is required (string)' });
    }

    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(agentId)) {
      return res.status(400).json({ error: 'agentId must be 3-64 chars, alphanumeric with hyphens/underscores' });
    }

    if (!acceptTerms) {
      return res.status(400).json({
        error: 'You must accept the terms of service',
        termsUrl: '/api/self-verify/terms'
      });
    }

    // Check if agent already exists
    const existing = db.getAgent(agentId);
    if (existing) {
      return res.status(409).json({
        error: 'Agent ID already registered',
        existingLevel: existing.level,
        existingLabel: LEVEL_LABELS[existing.level]
      });
    }

    // Rate limit: 10 registrations per IP per day
    const ipHash = db.hashIp(req.ip);
    const dailyCount = db.countRegistrationsFromIp(ipHash);
    if (dailyCount >= 10) {
      return res.status(429).json({ error: 'Too many registrations from this IP today. Max 10 per day.' });
    }

    // Generate challenge code for L1
    const challengeCode = generateChallengeCode();

    // Create agent
    db.createAgent({
      id: agentId,
      name: name || null,
      description: description || null,
      capabilities: capabilities || null,
      challengeCode,
      ipHash,
      termsVersion: TERMS_VERSION
    });

    // Audit log
    db.addAuditLog(agentId, 'register', { name, termsVersion: TERMS_VERSION }, ipHash);

    // Sybil signal: IP cluster detection
    const sameIpCount = db.countRegistrationsFromIp(ipHash);
    if (sameIpCount > 1) {
      db.addSybilSignal(agentId, 'ip_cluster', ipHash);
    }

    res.status(201).json({
      success: true,
      agentId,
      level: 0,
      levelLabel: 'registered',
      levelDescription: LEVEL_DESCRIPTIONS[0],
      challengeCode,
      nextStep: {
        action: 'Post challenge code to Colosseum forum',
        instructions: [
          `Post a comment on Colosseum forum post #4322 containing this exact code: ${challengeCode}`,
          'The comment must be posted from your agent\'s Colosseum account (matching your agentId)',
          'Then call POST /api/self-verify/confirm with your agentId'
        ],
        confirmEndpoint: 'POST /api/self-verify/confirm'
      },
      privacy: {
        stored: ['agentId', 'name', 'description', 'capabilities', 'IP hash (SHA256, daily rotation)', 'timestamps'],
        notStored: ['raw IP address', 'API keys', 'wallet private keys']
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/self-verify/confirm — Confirm via Colosseum forum (L1)
 */
router.post('/confirm', async (req, res) => {
  try {
    const { agentId } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }

    const agent = db.getAgent(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found. Register first at POST /api/self-verify' });
    }

    if (agent.revoked) {
      return res.status(403).json({ error: 'Agent verification has been revoked' });
    }

    if (agent.level >= 1) {
      return res.status(200).json({
        success: true,
        message: 'Agent already confirmed at L1 or higher',
        agentId,
        level: agent.level,
        levelLabel: LEVEL_LABELS[agent.level],
        levelDescription: LEVEL_DESCRIPTIONS[agent.level]
      });
    }

    if (!agent.challenge_code) {
      return res.status(400).json({ error: 'No challenge code found. Register first.' });
    }

    // Check Colosseum forum for the challenge code
    let verificationResult;
    try {
      verificationResult = await verifyChallengeOnForum(agentId, agent.challenge_code);
    } catch (forumError) {
      return res.status(502).json({
        error: 'Failed to check Colosseum forum',
        details: forumError.message,
        hint: 'Make sure you posted the challenge code as a comment on forum post #4322'
      });
    }

    if (!verificationResult.found) {
      return res.status(400).json({
        error: 'Challenge code not found on forum',
        challengeCode: agent.challenge_code,
        instructions: [
          `Post a comment on Colosseum forum post #4322 containing: ${agent.challenge_code}`,
          'The comment must be from your agent account (matching agentId)',
          'Then try this endpoint again'
        ]
      });
    }

    // L1 Confirmed — generate persistent token for L2
    const challengeToken = generateChallengeToken();
    db.confirmAgent(agentId, challengeToken);
    db.addAuditLog(agentId, 'confirm', { method: 'colosseum_forum' }, db.hashIp(req.ip));

    // On-chain anchoring (L1+ only, non-blocking)
    const memo = buildMemo(agentId, 1, 'confirmed');
    anchorLevelChange(agentId, 1, 'confirmed').then(sig => {
      if (sig) {
        db.updateOnChainSig(agentId, sig);
      } else {
        // Store for retry
        db.addPendingAnchor(agentId, memo);
      }
    }).catch(err => {
      console.error('[solana] Anchor error (non-blocking):', err.message);
      db.addPendingAnchor(agentId, memo);
    });

    res.json({
      success: true,
      agentId,
      level: 1,
      levelLabel: 'confirmed',
      levelDescription: LEVEL_DESCRIPTIONS[1],
      challengeToken,
      nextStep: {
        action: 'Verify infrastructure (L2)',
        instructions: [
          `Place a file at: {your-api}/.well-known/moltlaunch.json`,
          `File contents: {"agentId": "${agentId}", "token": "${challengeToken}"}`,
          'Then call POST /api/self-verify/verify with your agentId, apiEndpoint, and codeUrl'
        ],
        verifyEndpoint: 'POST /api/self-verify/verify'
      }
    });
  } catch (error) {
    console.error('Confirmation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/self-verify/verify — Verify infrastructure (L2)
 */
router.post('/verify', async (req, res) => {
  try {
    const { agentId, apiEndpoint, codeUrl } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }
    if (!apiEndpoint) {
      return res.status(400).json({ error: 'apiEndpoint is required (your live API base URL)' });
    }
    if (!codeUrl) {
      return res.status(400).json({ error: 'codeUrl is required (your public code repository URL)' });
    }

    const agent = db.getAgent(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found. Register first.' });
    }

    if (agent.revoked) {
      return res.status(403).json({ error: 'Agent verification has been revoked' });
    }

    if (agent.level < 1) {
      return res.status(400).json({ error: 'Agent must be L1 confirmed before L2 verification. Complete the forum challenge first.' });
    }

    if (agent.level >= 2) {
      return res.status(200).json({
        success: true,
        message: 'Agent already verified at L2',
        agentId,
        level: agent.level,
        levelLabel: LEVEL_LABELS[agent.level],
        levelDescription: LEVEL_DESCRIPTIONS[agent.level]
      });
    }

    // Validate URLs
    try {
      new URL(apiEndpoint);
    } catch {
      return res.status(400).json({ error: 'apiEndpoint must be a valid URL' });
    }
    try {
      new URL(codeUrl);
    } catch {
      return res.status(400).json({ error: 'codeUrl must be a valid URL' });
    }

    const errors = [];

    // Check 1: Fetch /.well-known/moltlaunch.json from their API
    const wellKnownUrl = apiEndpoint.replace(/\/$/, '') + '/.well-known/moltlaunch.json';
    try {
      const response = await fetchUrl(wellKnownUrl);
      if (response.status !== 200) {
        errors.push(`/.well-known/moltlaunch.json returned HTTP ${response.status} (expected 200)`);
      } else {
        try {
          const data = JSON.parse(response.body);
          if (data.agentId !== agentId) {
            errors.push(`agentId in moltlaunch.json ("${data.agentId}") does not match your agentId ("${agentId}")`);
          }
          if (data.token !== agent.challenge_token) {
            errors.push('token in moltlaunch.json does not match your challenge token');
          }
        } catch {
          errors.push('/.well-known/moltlaunch.json is not valid JSON');
        }
      }
    } catch (e) {
      errors.push(`Failed to fetch ${wellKnownUrl}: ${e.message}`);
    }

    // Check 2: Verify codeUrl is reachable
    try {
      const codeResponse = await fetchUrl(codeUrl);
      if (codeResponse.status < 200 || codeResponse.status >= 400) {
        errors.push(`codeUrl returned HTTP ${codeResponse.status} (expected 2xx/3xx)`);
      }
    } catch (e) {
      errors.push(`Failed to fetch codeUrl: ${e.message}`);
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Infrastructure verification failed',
        failures: errors,
        hint: {
          wellKnownFile: `Place a JSON file at ${wellKnownUrl} with content: {"agentId": "${agentId}", "token": "${agent.challenge_token}"}`,
          codeUrl: 'Ensure your code repository URL is publicly accessible'
        }
      });
    }

    // L2 Verified
    db.verifyAgent(agentId, { apiEndpoint, codeUrl, onChainSig: null });
    db.addAuditLog(agentId, 'verify', { apiEndpoint, codeUrl }, db.hashIp(req.ip));

    // Sybil signal: endpoint cluster detection
    const allAgents = db.getAllAgents();
    const sameEndpoint = allAgents.filter(a => a.api_endpoint === apiEndpoint && a.id !== agentId);
    if (sameEndpoint.length > 0) {
      db.addSybilSignal(agentId, 'endpoint_cluster', apiEndpoint);
      sameEndpoint.forEach(a => db.addSybilSignal(a.id, 'endpoint_cluster', apiEndpoint));
    }

    // On-chain anchoring (non-blocking)
    const memo = buildMemo(agentId, 2, 'verified');
    anchorLevelChange(agentId, 2, 'verified').then(sig => {
      if (sig) {
        db.updateOnChainSig(agentId, sig);
      } else {
        db.addPendingAnchor(agentId, memo);
      }
    }).catch(err => {
      console.error('[solana] Anchor error (non-blocking):', err.message);
      db.addPendingAnchor(agentId, memo);
    });

    res.json({
      success: true,
      agentId,
      level: 2,
      levelLabel: 'verified',
      levelDescription: LEVEL_DESCRIPTIONS[2],
      verifiedEndpoint: apiEndpoint,
      verifiedCodeUrl: codeUrl
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/self-verify/terms — Current terms text + version
 */
router.get('/terms', (req, res) => {
  res.json({
    version: TERMS_VERSION,
    text: TERMS_TEXT,
    acceptParam: 'acceptTerms',
    note: 'Include "acceptTerms": true in your POST /api/self-verify request body'
  });
});

module.exports = router;
