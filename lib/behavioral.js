/**
 * behavioral.js — Behavioral fingerprinting for L3 verification
 * 
 * Adapted from behavioral-fingerprint/features.js + fingerprint.js
 * Uses pre-computed fingerprints from data/fingerprints.json for hackathon agents,
 * or can compute features from raw post data.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// --- Pre-computed fingerprint data ---
const FINGERPRINTS_PATH = path.join(__dirname, '..', 'fingerprints.json');
let fingerprintsCache = null;

function loadFingerprints() {
  if (fingerprintsCache) return fingerprintsCache;
  try {
    const raw = fs.readFileSync(FINGERPRINTS_PATH, 'utf-8');
    fingerprintsCache = JSON.parse(raw);
    console.log(`[behavioral] Loaded ${Object.keys(fingerprintsCache).length} pre-computed fingerprints`);
    return fingerprintsCache;
  } catch (e) {
    console.warn('[behavioral] Could not load fingerprints.json:', e.message);
    return {};
  }
}

// --- Topic keywords for on-the-fly feature extraction ---
const TOPIC_KEYWORDS = {
  trading: ['trading', 'trade', 'trades', 'trader', 'swap', 'perp', 'perpetual', 'long', 'short', 'pnl', 'profit', 'loss', 'portfolio', 'position', 'leverage', 'liquidat', 'dex', 'cex', 'orderbook', 'market-mak'],
  identity: ['identity', 'verification', 'verify', 'kyc', 'sybil', 'trust', 'reputation', 'credential', 'attestation', 'soulbound', 'badge', 'fingerprint', 'proof-of-human', 'proof of human'],
  security: ['security', 'audit', 'vulnerability', 'exploit', 'hack', 'injection', 'safety', 'sentinel', 'guardrail', 'malicious', 'prompt injection', 'jailbreak'],
  defi: ['defi', 'yield', 'stake', 'staking', 'liquidity', 'pool', 'amm', 'lending', 'borrow', 'vault', 'escrow', 'token', 'sol', 'usdc', 'spl', 'jupiter', 'raydium', 'orca', 'marinade', 'kamino'],
  infrastructure: ['infra', 'infrastructure', 'sdk', 'api', 'rpc', 'node', 'deploy', 'docker', 'server', 'database', 'backend', 'frontend', 'framework', 'protocol', 'anchor', 'solana', 'blockchain', 'on-chain', 'onchain', 'program', 'smart contract', 'cpi'],
  gaming: ['game', 'gaming', 'poker', 'casino', 'play', 'player', 'tournament', 'arena', 'competition', 'bet', 'wager', 'hand', 'table'],
  social: ['social', 'community', 'forum', 'chat', 'message', 'discord', 'twitter', 'collab', 'team', 'partner', 'integrate', 'integration', 'compose', 'composab'],
  prediction: ['predict', 'prediction', 'oracle', 'forecast', 'market', 'sentiment', 'signal', 'alpha', 'analysis', 'indicator', 'trend']
};

// --- Feature extraction (for on-the-fly computation) ---

function extractTimingFeatures(posts) {
  const hourDistribution = new Array(24).fill(0);
  const dayDistribution = new Array(7).fill(0);
  const timestamps = [];

  for (const post of posts) {
    const date = new Date(post.createdAt);
    hourDistribution[date.getUTCHours()]++;
    dayDistribution[date.getUTCDay()]++;
    timestamps.push(date.getTime());
  }

  const total = posts.length;
  const normalizedHour = hourDistribution.map(v => Math.round((v / total) * 10000) / 10000);
  const normalizedDay = dayDistribution.map(v => Math.round((v / total) * 10000) / 10000);

  timestamps.sort((a, b) => a - b);
  let avgInterval = 0;
  if (timestamps.length > 1) {
    let totalInterval = 0;
    for (let i = 1; i < timestamps.length; i++) {
      totalInterval += timestamps[i] - timestamps[i - 1];
    }
    avgInterval = Math.round((totalInterval / (timestamps.length - 1) / 3600000) * 100) / 100;
  }

  return { hourDistribution: normalizedHour, dayDistribution: normalizedDay, avgInterval };
}

function extractContentFeatures(posts) {
  let totalLength = 0;
  let totalWords = 0;
  const uniqueWords = new Set();
  let questionCount = 0;
  let codeBlockCount = 0;
  let markdownElements = 0;

  for (const post of posts) {
    const body = post.body || '';
    totalLength += body.length;
    const words = body.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(w => w.length > 1);
    totalWords += words.length;
    words.forEach(w => uniqueWords.add(w));
    if (body.includes('?')) questionCount++;
    const codeBlocks = (body.match(/```/g) || []).length;
    if (codeBlocks >= 2) codeBlockCount++;
    const mdHeaders = (body.match(/^#{1,6}\s/gm) || []).length;
    const mdBold = (body.match(/\*\*[^*]+\*\*/g) || []).length;
    const mdLinks = (body.match(/\[([^\]]+)\]\([^)]+\)/g) || []).length;
    const mdLists = (body.match(/^[\s]*[-*+]\s/gm) || []).length;
    markdownElements += mdHeaders + mdBold + mdLinks + mdLists;
  }

  const n = posts.length;
  return {
    avgLength: Math.round(totalLength / n),
    vocabRichness: totalWords > 0 ? Math.round((uniqueWords.size / totalWords) * 10000) / 10000 : 0,
    questionRatio: Math.round((questionCount / n) * 10000) / 10000,
    codeBlockRatio: Math.round((codeBlockCount / n) * 10000) / 10000,
    markdownDensity: Math.round((markdownElements / n) * 100) / 100
  };
}

function extractTopicFeatures(posts) {
  const topicCounts = {};
  for (const topic of Object.keys(TOPIC_KEYWORDS)) topicCounts[topic] = 0;

  for (const post of posts) {
    const text = ((post.title || '') + ' ' + (post.body || '')).toLowerCase();
    for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
      for (const keyword of keywords) {
        if (text.includes(keyword)) { topicCounts[topic]++; break; }
      }
    }
  }

  const n = posts.length;
  const topicDistribution = {};
  for (const [topic, count] of Object.entries(topicCounts)) {
    topicDistribution[topic] = Math.round((count / n) * 10000) / 10000;
  }
  return { topicDistribution };
}

function extractAllFeatures(posts) {
  const timing = extractTimingFeatures(posts);
  const content = extractContentFeatures(posts);
  const topics = extractTopicFeatures(posts);
  return { timing, content, topics };
}

// --- Fingerprint hash generation ---

function generateFingerprint(features) {
  const hashInput = {
    timing: {
      hourDistribution: features.timing.hourDistribution,
      dayDistribution: features.timing.dayDistribution,
      avgInterval: features.timing.avgInterval
    },
    content: {
      avgLength: features.content.avgLength,
      vocabRichness: features.content.vocabRichness,
      questionRatio: features.content.questionRatio,
      codeBlockRatio: features.content.codeBlockRatio
    },
    topics: {
      topicDistribution: features.topics.topicDistribution
    }
  };

  const serialized = JSON.stringify(hashInput);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

// --- Similarity comparison ---

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function combinedSimilarity(f1, f2) {
  // Timing similarity
  const hourSim = cosineSimilarity(f1.timing.hourDistribution, f2.timing.hourDistribution);
  const daySim = cosineSimilarity(f1.timing.dayDistribution, f2.timing.dayDistribution);
  const maxInterval = Math.max(f1.timing.avgInterval, f2.timing.avgInterval, 1);
  const intervalSim = 1 - Math.abs(f1.timing.avgInterval - f2.timing.avgInterval) / maxInterval;
  const timing = hourSim * 0.5 + daySim * 0.3 + intervalSim * 0.2;

  // Content similarity
  const c1 = f1.content, c2 = f2.content;
  const maxLen = Math.max(c1.avgLength, c2.avgLength, 1);
  const lenSim = 1 - Math.abs(c1.avgLength - c2.avgLength) / maxLen;
  const vocabSim = 1 - Math.abs(c1.vocabRichness - c2.vocabRichness);
  const qSim = 1 - Math.abs(c1.questionRatio - c2.questionRatio);
  const codeSim = 1 - Math.abs(c1.codeBlockRatio - c2.codeBlockRatio);
  const content = lenSim * 0.3 + vocabSim * 0.3 + qSim * 0.2 + codeSim * 0.2;

  // Topic similarity
  const topics1 = Object.keys(f1.topics.topicDistribution);
  const v1 = topics1.map(t => f1.topics.topicDistribution[t] || 0);
  const v2 = topics1.map(t => (f2.topics.topicDistribution || {})[t] || 0);
  const topic = cosineSimilarity(v1, v2);

  return {
    timing: Math.round(timing * 10000) / 10000,
    content: Math.round(content * 10000) / 10000,
    topic: Math.round(topic * 10000) / 10000,
    combined: Math.round((timing * 0.3 + content * 0.3 + topic * 0.4) * 10000) / 10000
  };
}

/**
 * Compute uniqueness score for an agent by comparing against all pre-computed fingerprints.
 * Returns value between 0 (very similar to others = Sybil risk) and 1 (very unique).
 * The score is 1 - avgSimilarity, so higher = more unique.
 */
function computeUniqueness(agentFeatures, excludeAgent) {
  const fingerprints = loadFingerprints();
  const agents = Object.entries(fingerprints).filter(([name]) => name !== excludeAgent);

  if (agents.length === 0) return 1.0; // No comparisons = unique by default

  // Sample up to 50 agents for performance
  const sample = agents.length <= 50 ? agents : agents.sort(() => Math.random() - 0.5).slice(0, 50);

  let totalSim = 0;
  let comparisons = 0;

  for (const [, data] of sample) {
    if (!data.features) continue;
    const sim = combinedSimilarity(agentFeatures, data.features);
    totalSim += sim.combined;
    comparisons++;
  }

  if (comparisons === 0) return 1.0;

  const avgSimilarity = totalSim / comparisons;
  return Math.round((1 - avgSimilarity) * 10000) / 10000;
}

/**
 * Get or compute behavioral fingerprint for an agent.
 * First checks pre-computed data, then falls back to minimal features.
 */
function getBehavioralFingerprint(agentId) {
  const fingerprints = loadFingerprints();

  // Check pre-computed fingerprints
  if (fingerprints[agentId]) {
    const data = fingerprints[agentId];
    const uniqueness = computeUniqueness(data.features, agentId);
    return {
      source: 'pre-computed',
      fingerprint: data.fingerprint,
      features: data.features,
      postCount: data.postCount || null,
      uniquenessScore: uniqueness
    };
  }

  return null; // Not found in pre-computed data
}

module.exports = {
  loadFingerprints,
  getBehavioralFingerprint,
  computeUniqueness,
  generateFingerprint,
  combinedSimilarity,
  extractAllFeatures,
  TOPIC_KEYWORDS
};
