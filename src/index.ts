/**
 * @file Main Entry Point (Hybrid CLI/API with Stvor Transport)
 * 
 * Doolittle-style CLI entry point for Stvor AI Security.
 * Supports two boot modes:
 *   - `bun start cli`  : Interactive CLI with ElizaOS prompt loop + transport
 *   - `bun start api`  : HTTP API server with integrated Stvor relay
 *   - Default (no args): API mode
 * 
 * Tiered booting ensures fast startup (<50ms):
 *   1. Load settings (immediate)
 *   2. Create runtime
 *   3. Register plugins
 *   4. Initialize transport (Ed25519 + X25519 + AES-256-GCM)
 *   5. Boot in chosen mode
 */

import { initializeSettings, validateSettings, printSettings } from './core/settings';
import { isProductionMode } from './core/production';
import { AgentRuntime } from './core/runtime';
import type { ICommercePlugin } from '../packages/plugin-agent-commerce/src';
import { createCommercePlugin } from '../packages/plugin-agent-commerce/src';
import { createCommerceTransportBridge } from '../packages/plugin-agent-commerce/src/lifecycle';
import { ApiServer } from './api/server';
import { StvorTransportManager } from './transport/pqc';
import readline from 'readline';

/**
 * Parse command-line arguments.
 * Usage:
 *   bun start              # API mode (default)
 *   bun start cli          # CLI mode
 *   bun start api          # API mode (explicit)
 */
function parseArgs(): 'cli' | 'api' {
  const args = process.argv.slice(2);
  if (args.includes('cli')) return 'cli';
  return 'api'; // Default
}

/**
 * Initialize and connect the Stvor transport layer.
 * 
 * Process:
 *   1. Create StvorTransportManager with config
 *   2. Connect to Stvor relay (sat-v1 encrypted transport)
 *   3. Create transport bridge to wire into commerce plugin
 *   4. Register event listeners
 */
async function initializeTransport(
  runtime: AgentRuntime,
  commercePlugin: ICommercePlugin,
): Promise<StvorTransportManager> {
  const agentId = runtime.settings.agentId;
  const relayUrl = runtime.settings.relayUrl || 'local';
  const appToken = runtime.settings.appToken;

  console.log(`\n[Bootstrap] Initializing Stvor Transport...`);
  const transport = new StvorTransportManager({
    agentId,
    appToken,
    relayUrl,
  });

  try {
    await transport.connect();
    console.log(`[Bootstrap] Transport connected`);

    // Create event listener bridge
    const context = commercePlugin.getContext();
    const eventBridge = createCommerceTransportBridge(transport, context);
    commercePlugin.registerEventListener(eventBridge);

    return transport;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isProductionMode()) {
      console.error(`[Bootstrap] Transport connection failed in production: ${message}`);
      throw new Error(`Transport initialization failed: ${message}`);
    }
    console.warn(`[Bootstrap] Transport connection failed: ${message}`);
    console.warn(`[Bootstrap] Continuing without transport (local mode)`);
    return transport;
  }
}

/**
 * CLI Loop: Interactive ElizaOS-style prompt for agents.
 * 
 * Simulates the Doolittle CLI where agents can:
 *   - Create jobs
 *   - Check job status
 *   - Submit deliverables
 *   - Interact with commerce protocol
 *   - Monitor transport status
 */
async function runCliMode(
  runtime: AgentRuntime,
  transport: StvorTransportManager | null,
): Promise<void> {
  const commerce = runtime.getPlugin<ICommercePlugin>('agent-commerce');
  if (!commerce) {
    console.error('[CLI] Commerce plugin not loaded');
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question(`[${runtime.settings.agentId}]$ `, async (input) => {
      if (!input.trim()) {
        prompt();
        return;
      }

      const parts = input.trim().split(' ');
      const cmd = parts[0];

      try {
        switch (cmd) {
          case 'help':
            console.log(`
Commerce Commands:
  create-job <client> <provider> <task> <amount>  - Create a job
  fund-job <jobId> <client> <amount>              - Fund a job
  submit-job <jobId> <provider> <hash>            - Submit deliverable
  evaluate <jobId> <decision>                     - Evaluate job (ACCEPT/REJECT)
  status <jobId>                                  - Get job state
  list <agentId>                                  - List jobs for agent

Transport Commands:
  transport-status                                - Check transport connection
  transport-session <agentId>                     - Get crypto session info
  transport-stats                                 - Show encryption stats

Other:
  exit                                            - Exit CLI
            `);
            break;

          case 'create-job':
            if (parts.length < 5) {
              console.log('Usage: create-job <client> <provider> <task> <amount>');
            } else {
              const job = await commerce.createJob(
                parts[1],
                parts[2],
                parts.slice(3, -1).join(' '),
                BigInt(parts[parts.length - 1]),
              );
              console.log(`✓ Job created: ${job.jobId}`);
            }
            break;

          case 'fund-job':
            if (parts.length < 4) {
              console.log('Usage: fund-job <jobId> <client> <amount>');
            } else {
              const job = await commerce.fundJob(
                parts[1],
                parts[2],
                BigInt(parts[3]),
              );
              console.log(`✓ Job funded: state=${job.state}`);
            }
            break;

          case 'submit-job':
            if (parts.length < 4) {
              console.log('Usage: submit-job <jobId> <provider> <hash>');
            } else {
              const job = await commerce.submitJob(
                parts[1],
                parts[2],
                parts[3],
              );
              console.log(`✓ Job submitted: state=${job.state}`);
            }
            break;

          case 'evaluate':
            if (parts.length < 3) {
              console.log('Usage: evaluate <jobId> <decision>');
            } else {
              const callerAgent = runtime.settings.agentId;
              const job = await commerce.evaluateJob(
                parts[1],
                callerAgent,
                parts[2].toUpperCase() as 'ACCEPT' | 'REJECT' | 'PARTIAL',
              );
              console.log(`✓ Job evaluated: state=${job.state}`);
            }
            break;

          case 'status':
            if (parts.length < 2) {
              console.log('Usage: status <jobId>');
            } else {
              const state = await commerce.getJobState(parts[1]);
              console.log(`✓ Job state: ${state}`);
            }
            break;

          case 'list':
            if (parts.length < 2) {
              console.log('Usage: list <agentId>');
            } else {
              const jobs = await commerce.listJobs(parts[1]);
              console.log(`✓ ${jobs.length} jobs:`);
              jobs.forEach((j) => {
                console.log(
                  `  - ${j.jobId}: ${j.state} (created ${new Date(j.createdAt).toISOString()})`,
                );
              });
            }
            break;

          case 'transport-status':
            if (transport) {
              const status = await transport.getStatus();
              console.log(`✓ Transport Status:`);
              console.log(`  Connected: ${status.connected}`);
              console.log(`  Active Sessions: ${status.activeSessions}`);
              console.log(`  Messages Received: ${status.messagesReceived}`);
              console.log(`  Messages Sent: ${status.messagesSent}`);
            } else {
              console.log('✗ Transport not initialized');
            }
            break;

          case 'exit':
            console.log('Shutting down...');
            if (transport) {
              await transport.disconnect();
            }
            await runtime.shutdown();
            rl.close();
            process.exit(0);

          default:
            console.log(`✗ Unknown command: ${cmd}. Type 'help' for usage.`);
        }
      } catch (error) {
        console.error(
          `✗ Error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      prompt();
    });
  };

  console.log('\n=== Stvor AI Security Agent Node (CLI Mode) ===');
  console.log('Type "help" for available commands\n');
  prompt();
}

/**
 * Bootstrap the runtime and choose boot mode.
 */
async function main(): Promise<void> {
  try {
    // Phase 1: Load settings (fast)
    console.log('[Bootstrap] Initializing settings...');
    const settings = initializeSettings();
    validateSettings(settings);
    printSettings(settings);

    // Phase 2: Create runtime
    console.log('\n[Bootstrap] Creating runtime...');
    const runtime = new AgentRuntime(settings);

    // Phase 3: Register plugins
    console.log('[Bootstrap] Registering plugins...');
    const commercePlugin = createCommercePlugin();
    runtime.registerPlugin('agent-commerce', commercePlugin);

    // Phase 4: Boot runtime
    console.log('[Bootstrap] Booting runtime...');
    const bootMode = parseArgs();
    await runtime.boot(bootMode);

    // Phase 5: Initialize transport layer
    const transport = await initializeTransport(runtime, commercePlugin);

    console.log('[Bootstrap] Boot complete. Ready for commerce.\n');

    // Boot mode-specific initialization
    if (bootMode === 'cli') {
      await runCliMode(runtime, transport);
    } else {
      const apiServer = new ApiServer(runtime, transport || undefined);
      apiServer.start();

      // Keep server running
      await new Promise(() => {});
    }
  } catch (error) {
    console.error('[Fatal]', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run
main().catch(console.error);

export { agentCommercePlugin } from '../packages/plugin-agent-commerce/src/elizaos/index';
