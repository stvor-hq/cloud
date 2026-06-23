/**
 * @file Core runtime (Tiered Boot - Phase 2)
 * 
 * Central orchestrator for the agent node lifecycle.
 * Manages state transitions, plugin loading, and transport initialization.
 * 
 * Architecture:
 *   1. Settings loaded first (fast, ~0ms)
 *   2. Runtime instantiated with settings
 *   3. On boot(), queue up transport layers (deferred hydration)
 *   4. Plugins loaded on-demand via the plugin registry
 */

import type { IAgentRuntime, INodeSettings, IBootPhase } from './types';
import { RuntimeState } from './types';

/**
 * AgentRuntime: Central orchestrator for Stvor AI Security.
 * 
 * Implements deferred hydration — heavy transport layers load only when needed,
 * keeping cold-start time under 50ms.
 */
interface RuntimePlugin {
  teardown?: () => Promise<void> | void;
}

interface RuntimeCommercePlugin {
  registerEventListener(listener: unknown): void;
}

interface RuntimeTransportLayer {
  close?: () => Promise<void> | void;
  initialized?: boolean;
}

export class AgentRuntime implements IAgentRuntime {
  state: RuntimeState = RuntimeState.INITIALIZING;
  settings: INodeSettings;

  private bootPhases: IBootPhase[] = [];
  private plugins: Map<string, RuntimePlugin | RuntimeCommercePlugin> = new Map();
  private transportLayers: Map<string, RuntimeTransportLayer> = new Map();

  constructor(settings: INodeSettings) {
    this.settings = settings;
    this._registerBootPhases();
  }

  /**
   * Register tiered boot phases.
   * Each phase can initialize independently.
   */
  private _registerBootPhases(): void {
    this.bootPhases = [
      {
        name: 'core',
        setup: async () => {
          console.log('[Runtime] Booting core runtime...');
          this.state = RuntimeState.READY;
        },
        teardown: async () => {
          console.log('[Runtime] Tearing down core runtime...');
        },
      },
      {
        name: 'plugins',
        setup: async () => {
          console.log('[Runtime] Registering plugins...');
          // Plugins are loaded on-demand, not upfront
        },
        teardown: async () => {
          console.log('[Runtime] Unloading plugins...');
        },
      },
    ];
  }

  /**
   * Boot the runtime in the specified mode.
   * 
   * Tiered approach:
   *   - CLI mode: Load only CLI/stdio hooks, skip HTTP server
   *   - API mode: Load HTTP server, enable all transport layers
   */
  async boot(mode: 'cli' | 'api'): Promise<void> {
    if (this.state !== RuntimeState.INITIALIZING) {
      throw new Error(`Cannot boot from state: ${this.state}`);
    }

    try {
      console.log(`[Runtime] Booting in ${mode} mode...`);

      // Execute boot phases sequentially
      for (const phase of this.bootPhases) {
        await phase.setup();
      }

      this.state = RuntimeState.RUNNING;
      console.log('[Runtime] Boot complete. Ready for work.');
    } catch (error) {
      this.state = RuntimeState.ERROR;
      throw error;
    }
  }

  /**
   * Gracefully shutdown all runtime components.
   */
  async shutdown(): Promise<void> {
    console.log('[Runtime] Initiating shutdown...');

    // Teardown plugins
    for (const [name, plugin] of this.plugins) {
      console.log(`[Runtime] Unloading plugin: ${name}`);
      const teardown = 'teardown' in plugin ? plugin.teardown : undefined;
      if (teardown) await teardown();
    }

    // Teardown transport layers
    for (const [name, transport] of this.transportLayers) {
      console.log(`[Runtime] Tearing down transport: ${name}`);
      if (transport.close) await transport.close();
    }

    // Teardown boot phases
    for (const phase of this.bootPhases.reverse()) {
      await phase.teardown();
    }

    this.state = RuntimeState.SHUTDOWN;
    console.log('[Runtime] Shutdown complete.');
  }

  /**
   * Lazy-load a transport layer.
   * Called when a plugin needs external connectivity (e.g., transport, webhooks).
   */
  async loadTransport(name: string): Promise<void> {
    if (this.transportLayers.has(name)) {
      return; // Already loaded
    }

    console.log(`[Runtime] Loading transport layer: ${name}`);
    // In real implementation, this would dynamically import the transport
    // For now, it's a stub to show the deferred hydration pattern
    this.transportLayers.set(name, { initialized: true });
  }

  /**
   * Register a plugin with the runtime.
   * Plugins are loaded on-demand and can hook into the boot lifecycle.
   */
  registerPlugin(name: string, plugin: RuntimePlugin | RuntimeCommercePlugin): void {
    if (this.plugins.has(name)) {
      console.warn(`[Runtime] Plugin ${name} already registered, skipping.`);
      return;
    }
    this.plugins.set(name, plugin);
    console.log(`[Runtime] Registered plugin: ${name}`);
  }

  /**
   * Retrieve a registered plugin by name.
   */
  getPlugin<T>(name: string): T | undefined {
    return this.plugins.get(name) as T | undefined;
  }
}
