import { config, requireRpcEndpoints } from './config.js';
import type { RpcCallResult, RpcEndpoint } from './types.js';

interface RpcResponse<T> {
  jsonrpc: string;
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postRpc<T>(
  endpoint: RpcEndpoint,
  method: string,
  params: unknown[] | Record<string, unknown>,
): Promise<RpcCallResult<T>> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.rpcRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.rpcTimeoutMs);

    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `${endpoint.name}-${Date.now()}`,
          method,
          params,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`${endpoint.name} HTTP ${response.status}`);
      }

      const payload = (await response.json()) as RpcResponse<T>;
      if (payload.error) {
        throw new Error(
          `${endpoint.name} RPC ${payload.error.code}: ${payload.error.message}`,
        );
      }

      if (payload.result === undefined) {
        throw new Error(`${endpoint.name} returned an empty RPC result`);
      }

      const resultWithContext = payload.result as { context?: { slot?: number } };
      return {
        endpoint: endpoint.name,
        slot: resultWithContext.context?.slot,
        data: payload.result,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isRateLimited = lastError.message.includes('HTTP 429');
      if (isRateLimited) {
        break;
      }
      if (attempt < config.rpcRetries) {
        await sleep(350 * (attempt + 1));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error(`${endpoint.name} RPC request failed`);
}

export async function callRpc<T>(
  method: string,
  params: unknown[] | Record<string, unknown> = [],
): Promise<RpcCallResult<T>> {
  const endpoints = requireRpcEndpoints();
  const errors: string[] = [];

  for (const endpoint of endpoints) {
    try {
      return await postRpc<T>(endpoint, method, params);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`All RPC endpoints failed for ${method}: ${errors.join(' | ')}`);
}

export async function callRpcOnEndpoint<T>(
  endpoint: RpcEndpoint,
  method: string,
  params: unknown[] | Record<string, unknown> = [],
): Promise<RpcCallResult<T>> {
  return postRpc<T>(endpoint, method, params);
}
