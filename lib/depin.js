/**
 * depin.js — DePIN device binding for L4 verification
 * 
 * Adapted from depin-binding/providers/nosana.js, mock.js, and binding.js
 * Reads DePIN device PDAs from Solana and creates cryptographic bindings.
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');
const { anchorMemo } = require('./solana');

const NOSANA_NODES_PROGRAM = new PublicKey('nosNeZR64wiEhQc5j251bsP4WqDabT6hmz4PHyoHLGD');
const DEVNET_URL = 'https://api.devnet.solana.com';
const MAINNET_URL = process.env.SOLANA_MAINNET_RPC || 'https://api.mainnet-beta.solana.com';

/**
 * Read a DePIN device PDA from Solana
 * @param {string} provider - 'nosana' | 'helium' | 'mock'
 * @param {string} devicePDA - Public key string of the device PDA
 * @returns {Promise<object>} Device data
 */
async function readDevicePDA(provider, devicePDA) {
  if (provider === 'mock') {
    return createMockDevice(devicePDA);
  }

  // Real DePIN read — use mainnet
  const connection = new Connection(MAINNET_URL, 'confirmed');

  let pubkey;
  try {
    pubkey = new PublicKey(devicePDA);
  } catch (e) {
    throw new Error(`Invalid devicePDA public key: ${devicePDA}`);
  }

  const accountInfo = await connection.getAccountInfo(pubkey);

  if (!accountInfo) {
    throw new Error(`Device PDA not found on-chain: ${devicePDA}. Account does not exist.`);
  }

  // Parse based on provider
  if (provider === 'nosana') {
    return parseNosanaAccount(pubkey, accountInfo);
  }

  if (provider === 'helium') {
    return parseGenericAccount(pubkey, accountInfo, 'helium');
  }

  // Generic — just verify it exists
  return parseGenericAccount(pubkey, accountInfo, provider);
}

/**
 * Parse a Nosana node account
 */
function parseNosanaAccount(pubkey, accountInfo) {
  const data = accountInfo.data;
  const discriminator = Buffer.from(data.slice(0, 8)).toString('hex');

  let authorityPubkey = null;
  let nodeIdentityPubkey = null;
  try {
    authorityPubkey = new PublicKey(data.slice(8, 40)).toBase58();
    nodeIdentityPubkey = new PublicKey(data.slice(40, 72)).toBase58();
  } catch (e) { /* partial parse ok */ }

  return {
    provider: 'nosana',
    programId: NOSANA_NODES_PROGRAM.toBase58(),
    devicePDA: pubkey.toBase58(),
    accountData: {
      dataLength: data.length,
      lamports: accountInfo.lamports,
      owner: accountInfo.owner.toBase58(),
      discriminator,
      authorityPubkey,
      nodeIdentityPubkey,
      rawDataPreview: Buffer.from(data.slice(0, Math.min(128, data.length))).toString('hex')
    },
    isReal: true,
    notes: 'Real Nosana Node account read from Solana mainnet.'
  };
}

/**
 * Parse a generic DePIN account (just verifies existence + basic data)
 */
function parseGenericAccount(pubkey, accountInfo, provider) {
  return {
    provider,
    programId: accountInfo.owner.toBase58(),
    devicePDA: pubkey.toBase58(),
    accountData: {
      dataLength: accountInfo.data.length,
      lamports: accountInfo.lamports,
      owner: accountInfo.owner.toBase58(),
      rawDataPreview: Buffer.from(accountInfo.data.slice(0, Math.min(64, accountInfo.data.length))).toString('hex')
    },
    isReal: true,
    notes: `Real ${provider} account verified on Solana mainnet.`
  };
}

/**
 * Create a mock DePIN device attestation for testing
 */
function createMockDevice(devicePDA) {
  const seed = crypto.createHash('sha256')
    .update(`moltlaunch-mock-device-${devicePDA || 'default'}-v1`)
    .digest();

  return {
    provider: 'mock',
    programId: 'mock-depin-program',
    devicePDA: devicePDA || 'mock-device-pubkey',
    accountData: {
      deviceType: 'mock-depin-device',
      hardwareId: crypto.randomBytes(16).toString('hex'),
      firmwareVersion: '1.0.0-mock',
      registeredAt: Math.floor(Date.now() / 1000) - 86400 * 30,
      lastHeartbeat: Math.floor(Date.now() / 1000) - 3600,
      capabilities: {
        gpuModel: 'NVIDIA RTX 4090 (simulated)',
        cpuCores: 16,
        ramGB: 64,
        region: 'us-east-1'
      },
      _isMock: true
    },
    isReal: false,
    notes: 'MOCK device attestation for testing/demo purposes.'
  };
}

/**
 * Create a binding between an agent and a DePIN device
 */
function createBinding(agentId, deviceResult) {
  const timestamp = Date.now();
  const bindingInput = `${agentId}:${deviceResult.devicePDA}:${deviceResult.provider}:${timestamp}`;
  const bindingHash = crypto.createHash('sha256').update(bindingInput).digest('hex');

  return {
    agentId,
    depinProvider: deviceResult.provider,
    depinProgram: deviceResult.programId,
    devicePDA: deviceResult.devicePDA,
    deviceData: deviceResult.accountData,
    bindingHash,
    bindingInput,
    bindingTimestamp: timestamp,
    bindingTimestampISO: new Date(timestamp).toISOString(),
    verified: deviceResult.isReal,
    verificationMethod: deviceResult.isReal ? 'on-chain-read' : 'mock-simulated',
    verificationNotes: deviceResult.notes
  };
}

/**
 * Anchor a DePIN binding on-chain via Solana Memo
 * Format: molt:depin:{agentId}:{provider}:{bindingHash}:{timestamp}
 */
async function anchorBinding(binding) {
  const memoContent = `molt:depin:${binding.agentId}:${binding.depinProvider}:${binding.bindingHash}:${binding.bindingTimestamp}`;

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
    console.error('[depin] Anchor failed:', e.message);
    return null;
  }
}

module.exports = {
  readDevicePDA,
  createBinding,
  anchorBinding,
  createMockDevice,
  NOSANA_NODES_PROGRAM
};
