// src/contracts/on-chain.ts
// Thin wrapper around deployed AgenticCommerce on Sepolia.
// Falls back to mock ledger if contract address is not configured.

import { createHash } from 'crypto';

export interface OnChainJob {
  jobId: string;
  txHash: string;
  blockNumber: number;
  contractAddress: string;
  network: string;
}

export interface ContractAddresses {
  network: string;
  chainId: number;
  token: string;
  agenticCommerce: string;
  deployedAt: string;
  deployer: string;
}

/**
 * Load deployed contract addresses.
 * Returns null if contracts not deployed yet (falls back to mock).
 */
export function loadContractAddresses(): ContractAddresses | null {
  try {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.resolve('./src/contracts/addresses.json');
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ContractAddresses;
  } catch {
    return null;
  }
}

/**
 * Generate a deterministic SHA-256 attestation hash for a job payload.
 * This is what gets stored in the contract's `deliverable` field (bytes32).
 */
export function computeAttestationHash(payload: unknown): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
  return '0x' + hash;
}

/**
 * Check if on-chain deployment is available.
 */
export function isOnChainAvailable(): boolean {
  const addresses = loadContractAddresses();
  if (!addresses) return false;
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  return !!rpcUrl && !!addresses.agenticCommerce;
}

/**
 * Get deployment info for display in demo and README.
 */
export function getDeploymentInfo(): string {
  const addresses = loadContractAddresses();
  if (!addresses) return 'Not deployed (mock mode)';
  return `${addresses.network} | ${addresses.agenticCommerce} | deployed ${addresses.deployedAt}`;
}
