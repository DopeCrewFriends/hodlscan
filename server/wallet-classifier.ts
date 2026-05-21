import { callRpc } from './rpc.js';
import type { WalletClassification, WalletType } from './types.js';

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const CLASSIFY_CHUNK_SIZE = 25;

const KNOWN_DEX_PROGRAMS = new Map<string, string>([
  ['675kPX9MHTjS2zt1qfr1NY1WYfEE2Z7d8fDeyrBqrxDp', 'raydium_amm_v4'],
  ['CPMMoo8L3F4NbTegBCKVNnCUXCPqCq3QWQ3t9g7P3Qb', 'raydium_cpmm'],
  ['CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', 'raydium_clmm'],
  ['whirLbMiicVdio4qvUfM5KAg6Ct8V8yCNeY1FyXcG7w', 'orca_whirlpool'],
  ['whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', 'orca_whirlpool'],
  ['9W959DqEETiGZocYWCQPaJ6NbGqyxdcH1jV2m15kRL3', 'orca_token_swap_v2'],
  ['DjVE6JNiYqPL2QX1qg7UvdM28xBvSht8Lw3pSgeCRM6j', 'orca_token_swap_v1'],
  ['LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', 'meteora_dlmm'],
  ['Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', 'meteora_pools'],
  ['pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', 'pumpswap'],
]);

interface MultipleAccountsResult {
  context: { slot: number };
  value: Array<{
    executable: boolean;
    owner: string;
  } | null>;
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function buildClassification(
  owner: string,
  walletType: WalletType,
  source: string,
  confidence: number,
  excludeFromHolderStats: boolean,
): WalletClassification {
  return {
    owner,
    wallet_type: walletType,
    classification_source: source,
    classification_confidence: confidence,
    exclude_from_holder_stats: excludeFromHolderStats,
    updated_at: new Date().toISOString(),
  };
}

function classifyAccount(
  owner: string,
  account: MultipleAccountsResult['value'][number],
): WalletClassification {
  if (!account) {
    return buildClassification(owner, 'unknown', 'rpc_account_missing', 0.2, false);
  }

  const dexName = KNOWN_DEX_PROGRAMS.get(account.owner);
  if (dexName) {
    return buildClassification(
      owner,
      'liquidity_pool',
      `rpc_owner:${dexName}`,
      0.92,
      true,
    );
  }

  if (account.executable) {
    return buildClassification(owner, 'program', 'rpc_executable_account', 0.85, true);
  }

  if (account.owner === SYSTEM_PROGRAM_ID) {
    return buildClassification(owner, 'wallet', 'rpc_system_account', 0.75, false);
  }

  return buildClassification(
    owner,
    'unknown',
    `rpc_owner:${account.owner}`,
    0.45,
    false,
  );
}

export async function classifyWalletOwners(
  owners: string[],
): Promise<WalletClassification[]> {
  const uniqueOwners = [...new Set(owners)];
  const classifications: WalletClassification[] = [];

  for (const ownerChunk of chunk(uniqueOwners, CLASSIFY_CHUNK_SIZE)) {
    try {
      const response = await callRpc<MultipleAccountsResult>('getMultipleAccounts', [
        ownerChunk,
        {
          commitment: 'confirmed',
          encoding: 'base64',
          dataSlice: { offset: 0, length: 0 },
        },
      ]);

      response.data.value.forEach((account, index) => {
        classifications.push(classifyAccount(ownerChunk[index], account));
      });
    } catch (error) {
      const source = `rpc_classification_failed:${
        error instanceof Error ? error.message : String(error)
      }`;
      classifications.push(
        ...ownerChunk.map((owner) =>
          buildClassification(owner, 'unknown', source, 0, false),
        ),
      );
    }
  }

  return classifications;
}
