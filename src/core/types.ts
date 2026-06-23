/**
 * @file Shared type definitions for Stvor AI Security
 * 
 * Core architectural types used across the agent node runtime.
 * Follows strict TypeScript conventions for Web3 infrastructure.
 */

/** Boot mode for the node */
export type BootMode = 'cli' | 'api';

/** Configuration sourced from environment + defaults */
export interface INodeSettings {
  mode: BootMode;
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  dbPath: string;
  agentId: string;
  relayUrl: string;
  apiKey: string;
  appToken: string;
}

/** Runtime state machine state */
export enum RuntimeState {
  INITIALIZING = 'initializing',
  READY = 'ready',
  RUNNING = 'running',
  PAUSED = 'paused',
  SHUTDOWN = 'shutdown',
  ERROR = 'error',
}

/** Tiered boot lifecycle hooks */
export interface IBootPhase {
  name: string;
  setup(): Promise<void>;
  teardown(): Promise<void>;
}

/** Core runtime interface */
export interface IAgentRuntime {
  state: RuntimeState;
  settings: INodeSettings;
  boot(mode: BootMode): Promise<void>;
  shutdown(): Promise<void>;
  loadTransport(name: string): Promise<void>;
}

/** ERC-8183 Job states (enum for commerce protocol) */
export enum ERC8183JobState {
  OPEN = 'OPEN',
  FUNDED = 'FUNDED',
  SUBMITTED = 'SUBMITTED',
  ACCEPTED = 'ACCEPTED',
  COMPLETE = 'COMPLETE',
  REFUND = 'REFUND',
  EXPIRED = 'EXPIRED',
  ABORTED = 'ABORTED',
  TERMINAL = 'TERMINAL',
}

/** Core agent identity for Stvor transport */
export interface IAgentIdentity {
  agentId: string;
  publicKey: string;
  reputation: number;
}
