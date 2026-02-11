/**
 * mobile.js — Solana Mobile seed vault verification for L5
 * 
 * Verifies Ed25519 signatures from a Solana Mobile device's seed vault.
 * The challenge-response proves the agent runs on (or has access to)
 * a specific physical device with hardware-protected keys.
 */

const crypto = require('crypto');
const nacl = require('tweetnacl');
const { PublicKey } = require('@solana/web3.js');
const { anchorMemo } = require('./solana');

// In-memory challenge store (keyed by agentId)
// In production, this would be in the database
const challenges = new Map();

const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a challenge for mobile verification
 * @param {string} agentId
 * @returns {{ challenge: string, expiresAt: number }}
 */
function generateChallenge(agentId) {
  const challenge = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + CHALLENGE_EXPIRY_MS;

  challenges.set(agentId, { challenge, expiresAt, used: false });

  // Clean up expired challenges periodically
  cleanExpiredChallenges();

  return { challenge, expiresAt };
}

/**
 * Verify a mobile challenge response
 * @param {string} agentId
 * @param {string} challengeResponse - Base64-encoded Ed25519 signature
 * @param {string} devicePubkeyStr - Solana public key string of the device
 * @returns {{ valid: boolean, error?: string }}
 */
function verifyChallenge(agentId, challengeResponse, devicePubkeyStr) {
  // 1. Look up the challenge
  const stored = challenges.get(agentId);
  if (!stored) {
    return { valid: false, error: 'No pending challenge found. Request one first via GET /api/self-verify/mobile/challenge' };
  }

  // 2. Check expiry
  if (Date.now() > stored.expiresAt) {
    challenges.delete(agentId);
    return { valid: false, error: 'Challenge expired. Request a new one.' };
  }

  // 3. Check if already used
  if (stored.used) {
    return { valid: false, error: 'Challenge already used. Request a new one.' };
  }

  // 4. Validate the device pubkey
  let devicePubkey;
  try {
    devicePubkey = new PublicKey(devicePubkeyStr);
  } catch (e) {
    return { valid: false, error: `Invalid devicePubkey: ${e.message}` };
  }

  // 5. Decode the signature
  let signatureBytes;
  try {
    signatureBytes = Buffer.from(challengeResponse, 'base64');
  } catch (e) {
    return { valid: false, error: 'Invalid challengeResponse: must be base64-encoded' };
  }

  if (signatureBytes.length !== 64) {
    return { valid: false, error: `Invalid signature length: expected 64 bytes, got ${signatureBytes.length}` };
  }

  // 6. Verify Ed25519 signature
  // The message that was signed is the raw challenge hex string as UTF-8 bytes
  const messageBytes = Buffer.from(stored.challenge, 'utf-8');
  const pubkeyBytes = devicePubkey.toBytes();

  const valid = nacl.sign.detached.verify(
    new Uint8Array(messageBytes),
    new Uint8Array(signatureBytes),
    new Uint8Array(pubkeyBytes)
  );

  if (!valid) {
    return { valid: false, error: 'Signature verification failed. The signature does not match the challenge + devicePubkey.' };
  }

  // 7. Mark challenge as used
  stored.used = true;

  return { valid: true };
}

/**
 * Anchor mobile verification on-chain via Solana Memo
 * Format: molt:mobile:{agentId}:{devicePubkey}:{timestamp}
 */
async function anchorMobileVerification(agentId, devicePubkey) {
  const timestamp = Math.floor(Date.now() / 1000);
  const memoContent = `molt:mobile:${agentId}:${devicePubkey}:${timestamp}`;

  try {
    const sig = await anchorMemo(memoContent);
    if (sig) {
      return {
        signature: sig,
        memoContent,
        explorerUrl: `https://explorer.solana.com/tx/${sig}?cluster=devnet`
      };
    }
    return null;
  } catch (e) {
    console.error('[mobile] Anchor failed:', e.message);
    return null;
  }
}

/**
 * Clean up expired challenges
 */
function cleanExpiredChallenges() {
  const now = Date.now();
  for (const [agentId, data] of challenges.entries()) {
    if (now > data.expiresAt + 60000) { // 1 min grace period
      challenges.delete(agentId);
    }
  }
}

module.exports = {
  generateChallenge,
  verifyChallenge,
  anchorMobileVerification
};
