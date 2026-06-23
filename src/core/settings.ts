/**
 * @file Settings initialization (Tiered Boot - Phase 1)
 *
 * This module handles environment loading and defaults.
 * Runs before the heavy runtime loads — critical for fast startup (<50ms target).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { randomBytes } from 'crypto';
import type { INodeSettings } from './types';
import { isProductionMode } from './production';
import { deriveAgentIdFromPublicKey } from '../agent-identity';
import { KeyStore } from '../transport/key-store';

function getAgentIdFile(): string {
  return process.env.STVOR_AGENT_ID_FILE ?? './data/agent-id';
}

function persistAgentId(agentId: string): void {
  const filePath = getAgentIdFile();
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, agentId, { mode: 0o600 });
}

function loadPersistedAgentId(): string | null {
  const filePath = getAgentIdFile();
  if (!existsSync(filePath)) return null;
  const value = readFileSync(filePath, 'utf8').trim();
  return value.length > 0 ? value : null;
}

function resolveAgentId(): string {
  if (process.env.STVOR_AGENT_ID) {
    return process.env.STVOR_AGENT_ID;
  }

  try {
    const keyPair = KeyStore.load();
    if (keyPair) {
      return deriveAgentIdFromPublicKey(keyPair.ik.public_key);
    }
  } catch {
    // KeyStore unavailable during early boot — fall through
  }

  const persisted = loadPersistedAgentId();
  if (persisted) {
    return persisted;
  }

  if (isProductionMode()) {
    throw new Error(
      'STVOR_AGENT_ID must be set in production, or a persisted identity key must exist',
    );
  }

  const generated = `agent-${randomBytes(16).toString('hex')}`;
  persistAgentId(generated);
  return generated;
}

/**
 * Initialize node settings from environment variables with fallbacks.
 * Designed for zero-allocation fast-path when defaults are used.
 */
export function initializeSettings(): INodeSettings {
  const production = isProductionMode();

  return {
    mode: (process.env.STVOR_MODE as 'cli' | 'api') || 'cli',
    port: parseInt(process.env.STVOR_PORT || '8080', 10),
    logLevel: (process.env.STVOR_LOG_LEVEL || 'info') as INodeSettings['logLevel'],
    dbPath: process.env.STVOR_DB_PATH || './stvor.db',
    agentId: resolveAgentId(),
    relayUrl: process.env.STVOR_RELAY_URL || (production ? (() => { throw new Error('STVOR_RELAY_URL must be set'); })() : 'local'),
    apiKey: process.env.STVOR_API_KEY || (production ? (() => { throw new Error('STVOR_API_KEY must be set'); })() : (() => { throw new Error('STVOR_API_KEY must be set'); })()),
    appToken: process.env.STVOR_APP_TOKEN || (production ? (() => { throw new Error('STVOR_APP_TOKEN must be set'); })() : (() => { throw new Error('STVOR_APP_TOKEN must be set'); })()),
  };
}

/**
 * Validate settings before runtime boot.
 * Throws if critical configuration is missing or invalid.
 */
export function validateSettings(settings: INodeSettings): void {
  if (!settings.agentId || settings.agentId.length === 0) {
    throw new Error('STVOR_AGENT_ID must be set');
  }
  if (!settings.relayUrl || settings.relayUrl.length === 0) {
    throw new Error('STVOR_RELAY_URL must be set');
  }
  if (settings.port < 1024 || settings.port > 65535) {
    throw new Error('STVOR_PORT must be between 1024 and 65535');
  }
  if (!['debug', 'info', 'warn', 'error'].includes(settings.logLevel)) {
    throw new Error('STVOR_LOG_LEVEL must be one of: debug, info, warn, error');
  }
}

/**
 * Pretty-print settings for CLI output.
 */
export function printSettings(settings: INodeSettings): void {
  console.log('┌─ Stvor AI Security Settings');
  console.log(`├─ Mode: ${settings.mode}`);
  console.log(`├─ Agent ID: ${settings.agentId}`);
  console.log(`├─ Port: ${settings.port}`);
  console.log(`├─ Log Level: ${settings.logLevel}`);
  console.log(`├─ Relay URL: ${settings.relayUrl}`);
  console.log(`├─ API Key: ${settings.apiKey ? '***' + settings.apiKey.slice(-4) : '(not set)'}`);
  console.log(`├─ App Token: ${settings.appToken ? '***' + settings.appToken.slice(-4) : '(not set)'}`);
  console.log(`└─ Database: ${settings.dbPath}`);
}
