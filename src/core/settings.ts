/**
 * @file Settings initialization (Tiered Boot - Phase 1)
 * 
 * This module handles environment loading and defaults.
 * Runs before the heavy runtime loads — critical for fast startup (<50ms target).
 */

import type { INodeSettings } from './types';

/**
 * Initialize node settings from environment variables with fallbacks.
 * Designed for zero-allocation fast-path when defaults are used.
 */
export function initializeSettings(): INodeSettings {
  return {
    mode: (process.env.STVOR_MODE as 'cli' | 'api') || 'cli',
    port: parseInt(process.env.STVOR_PORT || '8080', 10),
    logLevel: (process.env.STVOR_LOG_LEVEL || 'info') as INodeSettings['logLevel'],
    dbPath: process.env.STVOR_DB_PATH || './stvor.db',
    pqcEnabled: process.env.STVOR_PQC_ENABLED !== 'false',
    agentId: process.env.STVOR_AGENT_ID || `agent-${Date.now()}`,
    relayUrl: process.env.STVOR_RELAY_URL || 'local',
    apiKey: process.env.STVOR_API_KEY || 'stvor-demo-key',
    appToken: process.env.STVOR_APP_TOKEN || 'stvor_dev_test123',
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
  console.log('┌─ Stvor Cloud Settings');
  console.log(`├─ Mode: ${settings.mode}`);
  console.log(`├─ Agent ID: ${settings.agentId}`);
  console.log(`├─ Port: ${settings.port}`);
  console.log(`├─ Log Level: ${settings.logLevel}`);
  console.log(`├─ Relay URL: ${settings.relayUrl}`);
  console.log(`├─ API Key: ${settings.apiKey}`);
  console.log(`├─ App Token: ${settings.appToken}`);
  console.log(`├─ Database: ${settings.dbPath}`);
  console.log(`└─ PQC Enabled: ${settings.pqcEnabled ? '✓' : '✗'}`);
}
