const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateChallengeCode, generateChallengeToken } = require('../lib/challenges');
const { verifyChallengeOnForum, fetchUrl } = require('../lib/colosseum');
const { anchorLevelChange, buildMemo, anchorMemo } = require('../lib/solana');
const { getBehavioralFingerprint } = require('../lib/behavioral');
const { readDevicePDA, createBinding, anchorBinding } = require('../lib/depin');
const { generateChallenge, verifyChallenge, anchorMobileVerification } = require('../lib/mobile');

const LEVEL_DESCRIPTIONS = {
  0: 'Agent registered on MoltLaunch. Proves ability to make HTTP requests. Does NOT prove identity or uniqueness.',
  1: 'Agent confirmed identity via Colosseum forum challenge. Proves agent controls a Colosseum API key.',
  2: 'Agent verified infrastructure. Proves agent controls a live API endpoint with our verification token.',
  3: 'Agent behavioral identity computed. Proves agent has a unique behavioral fingerprint based on activity history. Sybil detection included.',
  4: 'Agent bound to DePIN hardware device. Proves agent is associated with a verified physical device on Solana (Nosana/Helium/io.net).',
  5: 'Agent verified via Solana Mobile seed vault. Proves agent runs on a specific physical device with hardware-protected keys. Strongest verification level.'
};

const LEVEL_LABELS = { 0: 'registered', 1: 'confirmed', 2: 'verified', 3: 'behavioral', 4: 'hardware', 5: 'mobile' };

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
 * POST /api/self-verify/behavioral — Behavioral fingerprint verification (L3)
 */
router.post('/behavioral', async (req, res) => {
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

    if (agent.level < 2) {
      return res.status(400).json({
        error: 'Agent must be L2 (verified) before L3 behavioral verification.',
        currentLevel: agent.level,
        currentLabel: LEVEL_LABELS[agent.level],
        requiredLevel: 2
      });
    }

    if (agent.level >= 3) {
      const ext = db.getExtendedVerification(agentId);
      return res.status(200).json({
        success: true,
        message: 'Agent already at L3 or higher',
        agentId,
        level: agent.level,
        levelLabel: LEVEL_LABELS[agent.level],
        levelDescription: LEVEL_DESCRIPTIONS[agent.level],
        fingerprint: ext ? ext.fingerprint : null,
        uniquenessScore: ext ? ext.fingerprint_uniqueness : null
      });
    }

    // Try to get behavioral fingerprint
    const result = getBehavioralFingerprint(agentId);

    if (!result) {
      return res.status(404).json({
        error: 'No behavioral data found for this agent',
        hint: 'Behavioral fingerprinting requires forum activity history. Your agent must have posts on the Colosseum forum to generate a fingerprint.',
        agentId
      });
    }

    const { fingerprint, features, uniquenessScore, postCount, source } = result;

    // Sybil detection
    if (uniquenessScore < 0.3) {
      db.addSybilSignal(agentId, 'behavioral_similarity', `uniqueness=${uniquenessScore}`);
    }

    // Store in DB and upgrade to L3
    db.setBehavioral(agentId, {
      fingerprint,
      uniqueness: uniquenessScore,
      features
    });

    db.addAuditLog(agentId, 'behavioral', {
      source,
      fingerprint,
      uniquenessScore,
      postCount
    }, db.hashIp(req.ip));

    // On-chain anchoring (non-blocking)
    const memo = buildMemo(agentId, 3, 'behavioral');
    anchorLevelChange(agentId, 3, 'behavioral').then(sig => {
      if (sig) db.updateOnChainSig(agentId, sig);
      else db.addPendingAnchor(agentId, memo);
    }).catch(err => {
      console.error('[solana] Anchor error (non-blocking):', err.message);
      db.addPendingAnchor(agentId, memo);
    });

    res.json({
      success: true,
      agentId,
      level: 3,
      levelLabel: 'behavioral',
      levelDescription: LEVEL_DESCRIPTIONS[3],
      fingerprint,
      uniquenessScore,
      features: {
        timing: features.timing,
        content: features.content,
        topics: features.topics
      },
      source,
      postCount,
      sybilFlag: uniquenessScore < 0.3 ? 'POTENTIAL_SYBIL' : null,
      nextStep: {
        action: 'Bind to DePIN hardware device (L4)',
        instructions: [
          'Call POST /api/self-verify/depin with your agentId, provider, and devicePDA',
          'Supported providers: nosana, helium, mock (for testing)',
          'devicePDA must be a valid Solana public key of a DePIN device account'
        ],
        depinEndpoint: 'POST /api/self-verify/depin'
      }
    });
  } catch (error) {
    console.error('Behavioral verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/self-verify/depin — DePIN device binding (L4)
 */
router.post('/depin', async (req, res) => {
  try {
    const { agentId, provider, devicePDA } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }
    if (!provider) {
      return res.status(400).json({ error: 'provider is required (nosana, helium, or mock)' });
    }
    if (!devicePDA) {
      return res.status(400).json({ error: 'devicePDA is required (Solana public key of device account)' });
    }

    const validProviders = ['nosana', 'helium', 'mock'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
        provided: provider
      });
    }

    const agent = db.getAgent(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found. Register first.' });
    }

    if (agent.revoked) {
      return res.status(403).json({ error: 'Agent verification has been revoked' });
    }

    if (agent.level < 3) {
      return res.status(400).json({
        error: 'Agent must be L3 (behavioral) before L4 hardware binding.',
        currentLevel: agent.level,
        currentLabel: LEVEL_LABELS[agent.level],
        requiredLevel: 3
      });
    }

    if (agent.level >= 4) {
      const ext = db.getExtendedVerification(agentId);
      return res.status(200).json({
        success: true,
        message: 'Agent already at L4 or higher',
        agentId,
        level: agent.level,
        levelLabel: LEVEL_LABELS[agent.level],
        levelDescription: LEVEL_DESCRIPTIONS[agent.level],
        depinProvider: ext ? ext.depin_provider : null,
        devicePDA: ext ? ext.depin_device_pda : null
      });
    }

    // Read the device PDA from Solana
    let deviceResult;
    try {
      deviceResult = await readDevicePDA(provider, devicePDA);
    } catch (err) {
      return res.status(400).json({
        error: 'Failed to read device PDA',
        details: err.message,
        hint: provider === 'mock'
          ? 'Mock provider should always work. This is unexpected.'
          : 'Ensure the devicePDA is a valid Solana public key of an existing account on mainnet.'
      });
    }

    // Create binding
    const binding = createBinding(agentId, deviceResult);

    // Anchor on-chain (non-blocking)
    let onChainResult = null;
    try {
      onChainResult = await anchorBinding(binding);
    } catch (e) {
      console.error('[depin] Anchor error:', e.message);
    }

    // Store in DB
    db.setHardware(agentId, {
      provider: binding.depinProvider,
      devicePDA: binding.devicePDA,
      bindingHash: binding.bindingHash,
      onChainSig: onChainResult ? onChainResult.signature : null
    });

    db.addAuditLog(agentId, 'depin_binding', {
      provider,
      devicePDA,
      bindingHash: binding.bindingHash,
      isReal: deviceResult.isReal,
      onChainSig: onChainResult ? onChainResult.signature : null
    }, db.hashIp(req.ip));

    res.json({
      success: true,
      agentId,
      level: 4,
      levelLabel: 'hardware',
      levelDescription: LEVEL_DESCRIPTIONS[4],
      binding: {
        provider: binding.depinProvider,
        devicePDA: binding.devicePDA,
        bindingHash: binding.bindingHash,
        isReal: deviceResult.isReal,
        verificationMethod: binding.verificationMethod,
        notes: binding.verificationNotes
      },
      deviceData: binding.deviceData,
      onChainSig: onChainResult ? onChainResult.signature : null,
      explorerUrl: onChainResult ? onChainResult.explorerUrl : null,
      nextStep: {
        action: 'Mobile seed vault verification (L5)',
        instructions: [
          '1. Request a challenge: GET /api/self-verify/mobile/challenge?agentId=YOUR_ID',
          '2. Sign the challenge with your Solana Mobile seed vault device key',
          '3. Submit: POST /api/self-verify/mobile with agentId, challengeResponse (base64), devicePubkey'
        ],
        challengeEndpoint: 'GET /api/self-verify/mobile/challenge',
        verifyEndpoint: 'POST /api/self-verify/mobile'
      }
    });
  } catch (error) {
    console.error('DePIN binding error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/self-verify/mobile/challenge — Request a challenge for L5 mobile verification
 */
router.get('/mobile/challenge', (req, res) => {
  try {
    const agentId = req.query.agentId;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId query parameter is required' });
    }

    const agent = db.getAgent(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found.' });
    }

    if (agent.level < 4) {
      return res.status(400).json({
        error: 'Agent must be L4 (hardware) before L5 mobile verification.',
        currentLevel: agent.level,
        currentLabel: LEVEL_LABELS[agent.level],
        requiredLevel: 4
      });
    }

    const { challenge, expiresAt } = generateChallenge(agentId);

    res.json({
      success: true,
      agentId,
      challenge,
      expiresAt,
      expiresIn: '5 minutes',
      instructions: [
        'Sign this challenge string with your Solana Mobile seed vault device key (Ed25519)',
        'The message to sign is the challenge hex string as UTF-8 bytes',
        'Submit the base64-encoded signature to POST /api/self-verify/mobile'
      ]
    });
  } catch (error) {
    console.error('Mobile challenge error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/self-verify/mobile — Mobile seed vault verification (L5)
 */
router.post('/mobile', async (req, res) => {
  try {
    const { agentId, challengeResponse, devicePubkey } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }
    if (!challengeResponse) {
      return res.status(400).json({ error: 'challengeResponse is required (base64-encoded Ed25519 signature)' });
    }
    if (!devicePubkey) {
      return res.status(400).json({ error: 'devicePubkey is required (Solana public key string)' });
    }

    const agent = db.getAgent(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found.' });
    }

    if (agent.revoked) {
      return res.status(403).json({ error: 'Agent verification has been revoked' });
    }

    if (agent.level < 4) {
      return res.status(400).json({
        error: 'Agent must be L4 (hardware) before L5 mobile verification.',
        currentLevel: agent.level,
        currentLabel: LEVEL_LABELS[agent.level],
        requiredLevel: 4
      });
    }

    if (agent.level >= 5) {
      const ext = db.getExtendedVerification(agentId);
      return res.status(200).json({
        success: true,
        message: 'Agent already at L5 (mobile)',
        agentId,
        level: 5,
        levelLabel: 'mobile',
        levelDescription: LEVEL_DESCRIPTIONS[5],
        devicePubkey: ext ? ext.mobile_device_pubkey : null
      });
    }

    // Verify the signature
    const verification = verifyChallenge(agentId, challengeResponse, devicePubkey);

    if (!verification.valid) {
      return res.status(400).json({
        error: 'Mobile verification failed',
        details: verification.error
      });
    }

    // Anchor on-chain (non-blocking)
    let onChainResult = null;
    try {
      onChainResult = await anchorMobileVerification(agentId, devicePubkey);
    } catch (e) {
      console.error('[mobile] Anchor error:', e.message);
    }

    // Store in DB
    db.setMobile(agentId, {
      devicePubkey,
      onChainSig: onChainResult ? onChainResult.signature : null
    });

    db.addAuditLog(agentId, 'mobile_verify', {
      devicePubkey,
      onChainSig: onChainResult ? onChainResult.signature : null
    }, db.hashIp(req.ip));

    res.json({
      success: true,
      agentId,
      level: 5,
      levelLabel: 'mobile',
      levelDescription: LEVEL_DESCRIPTIONS[5],
      verified: true,
      devicePubkey,
      onChainSig: onChainResult ? onChainResult.signature : null,
      explorerUrl: onChainResult ? onChainResult.explorerUrl : null
    });
  } catch (error) {
    console.error('Mobile verification error:', error);
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
