import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import type { RpcEndpoint } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

const heliusUrl =
  process.env.HELIUS_RPC_URL ||
  (process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : '');

export const config = {
  rootDir,
  port: Number(process.env.PORT || 4077),
  tokenMint:
    process.env.TOKEN_MINT || 'Hh3oTaqDCKKfdBgsQEvxp9sUwyNf8x9qmKqEMLBWpump',
  rpcTimeoutMs: Number(process.env.RPC_TIMEOUT_MS || 30_000),
  rpcRetries: Number(process.env.RPC_RETRIES || 2),
  maxDisplayHolders: Number(process.env.MAX_DISPLAY_HOLDERS || 250),
  refreshSecret: process.env.REFRESH_SECRET || process.env.CRON_SECRET || '',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  tokenPrograms: [
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEvGdJJj4pRjEwRsgdtJrRKCfr',
  ],
  rpcEndpoints: [
    process.env.QUICKNODE_RPC_URL
      ? {
          name: 'quicknode',
          url: process.env.QUICKNODE_RPC_URL,
        }
      : null,
    heliusUrl ? { name: 'helius', url: heliusUrl } : null,
  ].filter(Boolean) as RpcEndpoint[],
};

export function requireRpcEndpoints(): RpcEndpoint[] {
  if (config.rpcEndpoints.length === 0) {
    throw new Error(
      'No RPC endpoints configured. Set QUICKNODE_RPC_URL and HELIUS_RPC_URL or HELIUS_API_KEY.',
    );
  }

  return config.rpcEndpoints;
}
