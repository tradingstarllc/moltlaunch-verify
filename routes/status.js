const express = require('express');
const router = express.Router();
const db = require('../db');

const LEVEL_DESCRIPTIONS = {
  0: 'Agent registered on MoltLaunch. Proves ability to make HTTP requests. Does NOT prove identity or uniqueness.',
  1: 'Agent confirmed identity via Colosseum forum challenge. Proves agent controls a Colosseum API key.',
  2: 'Agent verified infrastructure. Proves agent controls a live API endpoint with our verification token.'
};

const LEVEL_LABELS = { 0: 'registered', 1: 'confirmed', 2: 'verified' };

/**
 * Format agent data for public response (strips sensitive fields)
 */
function publicAgentResponse(agent) {
  if (!agent) return null;

  const isExpired = agent.expires_at && new Date(agent.expires_at) < new Date();

  return {
    agentId: agent.id,
    name: agent.name,
    description: agent.description,
    capabilities: agent.capabilities ? JSON.parse(agent.capabilities) : null,
    level: agent.level,
    levelLabel: LEVEL_LABELS[agent.level],
    levelDescription: LEVEL_DESCRIPTIONS[agent.level],
    apiEndpoint: agent.api_endpoint,
    codeUrl: agent.code_url,
    onChainSig: agent.on_chain_sig,
    registeredAt: agent.registered_at,
    confirmedAt: agent.confirmed_at,
    verifiedAt: agent.verified_at,
    expiresAt: agent.expires_at,
    expired: isExpired,
    revoked: !!agent.revoked
  };
}

/**
 * GET /api/self-verify/status/:id — Check verification status by verificationId (agentId)
 */
router.get('/status/:id', (req, res) => {
  try {
    const agent = db.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const response = publicAgentResponse(agent);

    // Include challenge info if still at L0 (so they know how to proceed)
    if (agent.level === 0 && agent.challenge_code) {
      response.pendingChallenge = {
        code: agent.challenge_code,
        instructions: 'Post this code as a comment on Colosseum forum post #4322, then call POST /api/self-verify/confirm'
      };
    }

    // Include token info if at L1 (so they know how to proceed to L2)
    if (agent.level === 1 && agent.challenge_token) {
      response.pendingVerification = {
        token: agent.challenge_token,
        instructions: `Place {"agentId": "${agent.id}", "token": "${agent.challenge_token}"} at {your-api}/.well-known/moltlaunch.json, then call POST /api/self-verify/verify`
      };
    }

    res.json(response);
  } catch (error) {
    console.error('Status lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/self-verify/agent/:id — Public agent lookup by agentId
 */
router.get('/agent/:id', (req, res) => {
  try {
    const agent = db.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Public lookup — no challenge codes or tokens
    const isExpired = agent.expires_at && new Date(agent.expires_at) < new Date();

    res.json({
      agentId: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities: agent.capabilities ? JSON.parse(agent.capabilities) : null,
      level: agent.level,
      levelLabel: LEVEL_LABELS[agent.level],
      levelDescription: LEVEL_DESCRIPTIONS[agent.level],
      apiEndpoint: agent.api_endpoint,
      codeUrl: agent.code_url,
      onChainSig: agent.on_chain_sig,
      registeredAt: agent.registered_at,
      confirmedAt: agent.confirmed_at,
      verifiedAt: agent.verified_at,
      expiresAt: agent.expires_at,
      expired: isExpired,
      revoked: !!agent.revoked
    });
  } catch (error) {
    console.error('Agent lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/self-verify/batch — Batch lookup (requires L1+ agent auth)
 */
router.post('/batch', (req, res) => {
  try {
    const { agentId, agentIds } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required (your agent ID for authentication)' });
    }

    if (!agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
      return res.status(400).json({ error: 'agentIds array is required' });
    }

    if (agentIds.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 agent IDs per batch request' });
    }

    // Verify the requesting agent is L1+
    const requestingAgent = db.getAgent(agentId);
    if (!requestingAgent) {
      return res.status(404).json({ error: 'Your agentId not found. Register first.' });
    }

    if (requestingAgent.level < 1) {
      return res.status(403).json({
        error: 'Batch endpoint requires L1+ (confirmed) status',
        yourLevel: requestingAgent.level,
        hint: 'Complete the forum challenge to reach L1'
      });
    }

    if (requestingAgent.revoked) {
      return res.status(403).json({ error: 'Your agent verification has been revoked' });
    }

    // Fetch agents
    const agents = db.getAgentsByIds(agentIds);
    const results = {};

    // Build response for found agents
    for (const agent of agents) {
      const isExpired = agent.expires_at && new Date(agent.expires_at) < new Date();
      results[agent.id] = {
        found: true,
        level: agent.level,
        levelLabel: LEVEL_LABELS[agent.level],
        levelDescription: LEVEL_DESCRIPTIONS[agent.level],
        expired: isExpired,
        revoked: !!agent.revoked
      };
    }

    // Mark not-found agents
    for (const id of agentIds) {
      if (!results[id]) {
        results[id] = { found: false };
      }
    }

    db.addAuditLog(agentId, 'batch_lookup', { queriedCount: agentIds.length }, db.hashIp(req.ip));

    res.json({
      requestedBy: agentId,
      count: agentIds.length,
      found: agents.length,
      results
    });
  } catch (error) {
    console.error('Batch lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
