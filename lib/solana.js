const {
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  PublicKey,
  sendAndConfirmTransaction
} = require('@solana/web3.js');

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const DEVNET_URL = 'https://api.devnet.solana.com';

let keypair = null;
let connection = null;

function init() {
  if (keypair) return;

  const privateKeyStr = process.env.SOLANA_PRIVATE_KEY;
  if (!privateKeyStr) {
    console.warn('[solana] SOLANA_PRIVATE_KEY not set — on-chain anchoring disabled');
    return;
  }

  try {
    const secretKey = JSON.parse(privateKeyStr);
    keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    connection = new Connection(DEVNET_URL, 'confirmed');
    console.log(`[solana] Wallet loaded: ${keypair.publicKey.toBase58()}`);
  } catch (e) {
    console.error('[solana] Failed to load wallet:', e.message);
  }
}

/**
 * Build the memo string for on-chain anchoring
 * Format: molt:sv:{agentId}:L{level}:{label}:{unix_timestamp}
 */
function buildMemo(agentId, level, label) {
  const timestamp = Math.floor(Date.now() / 1000);
  return `molt:sv:${agentId}:L${level}:${label}:${timestamp}`;
}

/**
 * Send a Solana Memo transaction (devnet)
 * @param {string} memo - The memo string
 * @returns {Promise<string|null>} - Transaction signature or null on failure
 */
async function anchorMemo(memo) {
  init();

  if (!keypair || !connection) {
    console.warn('[solana] Anchoring skipped — wallet not configured');
    return null;
  }

  try {
    const instruction = new TransactionInstruction({
      keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo, 'utf-8')
    });

    const tx = new Transaction().add(instruction);

    const signature = await sendAndConfirmTransaction(connection, tx, [keypair], {
      commitment: 'confirmed',
      maxRetries: 3
    });

    console.log(`[solana] Anchored: ${memo} → ${signature}`);
    return signature;
  } catch (e) {
    console.error('[solana] Anchor failed:', e.message);
    return null;
  }
}

/**
 * Anchor an agent's level change
 * Returns signature or null (never throws — don't block the response)
 */
async function anchorLevelChange(agentId, level, label) {
  const memo = buildMemo(agentId, level, label);
  try {
    return await anchorMemo(memo);
  } catch (e) {
    console.error('[solana] anchorLevelChange error:', e.message);
    return null;
  }
}

module.exports = {
  init,
  buildMemo,
  anchorMemo,
  anchorLevelChange
};
