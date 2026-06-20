import { describe, it, expect } from 'bun:test';
import { MCP_TOOLS, MCP_SERVER_INFO } from '../src/mcp/server';

describe('MCP server', () => {
  it('has correct server info', () => {
    expect(MCP_SERVER_INFO.name).toBe('stvor-cloud');
    expect(MCP_SERVER_INFO.version).toBeDefined();
    expect(MCP_SERVER_INFO.description).toContain('ML-KEM-768');
  });

  it('exposes 5 tools', () => {
    expect(MCP_TOOLS).toHaveLength(5);
  });

  it('all tools have required fields', () => {
    for (const tool of MCP_TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('create_secure_job tool has correct schema', () => {
    const tool = MCP_TOOLS.find(t => t.name === 'create_secure_job')!;
    expect(tool.inputSchema.required).toContain('provider');
    expect(tool.inputSchema.required).toContain('task');
    expect(tool.inputSchema.required).toContain('budget');
  });
});
