const crypto = require('crypto');

/**
 * Generate a challenge code for L1 forum verification
 * Format: MOLT-VERIFY-{random8hex}-{timestamp}
 */
function generateChallengeCode() {
  const random = crypto.randomBytes(4).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);
  return `MOLT-VERIFY-${random}-${timestamp}`;
}

/**
 * Generate a persistent verification token for L2 endpoint challenge
 */
function generateChallengeToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  generateChallengeCode,
  generateChallengeToken
};
