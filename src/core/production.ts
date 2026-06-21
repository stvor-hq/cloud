export function isProductionMode(): boolean {
  return process.env.STVOR_PRODUCTION_MODE === 'true' || process.env.NODE_ENV === 'production';
}

export function requireProductionEnv(varName: string): void {
  const value = process.env[varName];
  if (!value || value.trim().length === 0) {
    throw new Error(`[Production] ${varName} is required in production mode.`);
  }
}

export function assertWssUrl(url: string, varName: string): void {
  if (!url.startsWith('wss://')) {
    throw new Error(`[Production] ${varName} must use wss:// in production. Got: ${url}`);
  }
}
