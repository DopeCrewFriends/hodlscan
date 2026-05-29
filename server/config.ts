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

export function isSupabaseConfigured() {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

export const config = {
  rootDir,
  port: Number(process.env.PORT || 4077),
  tokenMint:
    process.env.TOKEN_MINT || 'Hh3oTaqDCKKfdBgsQEvxp9sUwyNf8x9qmKqEMLBWpump',
  rpcTimeoutMs: Number(process.env.RPC_TIMEOUT_MS || 30_000),
  rpcRetries: Number(process.env.RPC_RETRIES || 2),
  maxDisplayHolders: Number(process.env.MAX_DISPLAY_HOLDERS || 500),
  walletPortfolioCacheTtlMs: Number(
    process.env.WALLET_PORTFOLIO_CACHE_TTL_MS || 10 * 60_000,
  ),
  autoRefreshMs: Number(process.env.AUTO_REFRESH_MS || 300_000),
  disableLocalAutoRefresh: process.env.DISABLE_LOCAL_AUTO_REFRESH === 'true',
  refreshSecret: process.env.REFRESH_SECRET || '',
  cronSecret: process.env.CRON_SECRET || '',
  duneApiKey: process.env.DUNE_API_KEY || '',
  supabaseUrl:
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  tokenPrograms: [
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEvGdJJj4pRjEwRsgdtJrRKCfr',
  ],
  rpcEndpoints: [
    heliusUrl ? { name: 'helius', url: heliusUrl } : null,
    process.env.HELIUS_RPC_URL_BETA
      ? { name: 'helius-beta', url: process.env.HELIUS_RPC_URL_BETA }
      : null,
    process.env.HELIUS_RPC_URL_FAST
      ? { name: 'helius-fast', url: process.env.HELIUS_RPC_URL_FAST }
      : null,
    process.env.QUICKNODE_RPC_URL
      ? {
          name: 'quicknode',
          url: process.env.QUICKNODE_RPC_URL,
        }
      : null,
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
