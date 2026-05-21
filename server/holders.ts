import bs58 from 'bs58';

import { config, requireRpcEndpoints } from './config.js';
import { callRpc, callRpcOnEndpoint } from './rpc.js';
import type { RpcEndpoint, TokenAccountHolder } from './types.js';

interface ProgramAccountsResult {
  context: { slot: number };
  value: Array<{
    pubkey: string;
    account: {
      data: [string, string] | string;
    };
  }>;
}

interface TokenSupplyResult {
  context: { slot: number };
  value: {
    amount: string;
    decimals: number;
    uiAmountString: string;
  };
}

interface LargestAccountsResult {
  context: { slot: number };
  value: Array<{
    address: string;
    amount: string;
    decimals: number;
    uiAmountString: string;
  }>;
}

interface MultipleAccountsResult {
  context: { slot: number };
  value: Array<{
    data: [string, string] | string;
  } | null>;
}

interface DasTokenAccountsResult {
  last_indexed_slot?: number;
  total?: number;
  limit?: number;
  page?: number;
  token_accounts?: Array<{
    address: string;
    owner: string;
    amount: number | string;
  }>;
}

export interface HolderScanResult {
  holders: TokenAccountHolder[];
  totalSupply: bigint;
  decimals: number;
  slot: number | null;
  status: 'complete' | 'partial';
  source: string;
  error?: string;
}

function decodeAccountData(data: [string, string] | string): Buffer {
  return Buffer.from(Array.isArray(data) ? data[0] : data, 'base64');
}

function parseTokenAccount(tokenAccount: string, data: Buffer): TokenAccountHolder {
  if (data.length < 72) {
    throw new Error(`Token account ${tokenAccount} is too small to parse`);
  }

  return {
    tokenAccount,
    owner: bs58.encode(data.subarray(32, 64)),
    rawAmount: data.readBigUInt64LE(64),
  };
}

async function scanDasTokenAccounts(
  totalSupply: bigint,
  decimals: number,
): Promise<HolderScanResult> {
  const limit = Number(process.env.DAS_TOKEN_ACCOUNTS_LIMIT || 1000);
  const maxPages = Number(process.env.DAS_TOKEN_ACCOUNTS_MAX_PAGES || 100);
  const holders: TokenAccountHolder[] = [];
  let slot: number | null = null;
  let source = '';

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await callRpc<DasTokenAccountsResult>('getTokenAccounts', {
      mint: config.tokenMint,
      page,
      limit,
    });
    const accounts = response.data.token_accounts || [];
    source = response.endpoint;
    slot = Math.max(slot || 0, response.data.last_indexed_slot || 0) || null;

    for (const account of accounts) {
      const rawAmount = BigInt(account.amount);
      if (rawAmount > 0n) {
        holders.push({
          tokenAccount: account.address,
          owner: account.owner,
          rawAmount,
        });
      }
    }

    if (accounts.length < limit) {
      return {
        holders,
        totalSupply,
        decimals,
        slot,
        status: 'complete',
        source: `${source}:getTokenAccounts`,
      };
    }
  }

  return {
    holders,
    totalSupply,
    decimals,
    slot,
    status: 'partial',
    source: `${source}:getTokenAccounts`,
    error: `Stopped after DAS_TOKEN_ACCOUNTS_MAX_PAGES=${maxPages}; holder count may be incomplete.`,
  };
}

async function getTokenSupply() {
  const supply = await callRpc<TokenSupplyResult>('getTokenSupply', [
    config.tokenMint,
    { commitment: 'confirmed' },
  ]);

  return {
    totalSupply: BigInt(supply.data.value.amount),
    decimals: supply.data.value.decimals,
    slot: supply.data.context.slot,
    source: `${supply.endpoint}:getTokenSupply`,
  };
}

async function scanEndpoint(endpoint: RpcEndpoint): Promise<{
  holders: TokenAccountHolder[];
  slot: number | null;
  source: string;
  warnings: string[];
}> {
  const holders: TokenAccountHolder[] = [];
  const warnings: string[] = [];
  let slot: number | null = null;

  for (const programId of config.tokenPrograms) {
    try {
      const filters =
        programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
          ? [
              { dataSize: 165 },
              { memcmp: { offset: 0, bytes: config.tokenMint } },
            ]
          : [{ memcmp: { offset: 0, bytes: config.tokenMint } }];
      const response = await callRpcOnEndpoint<ProgramAccountsResult>(
        endpoint,
        'getProgramAccounts',
        [
          programId,
          {
            encoding: 'base64',
            withContext: true,
            filters,
          },
        ],
      );

      slot = Math.max(slot || 0, response.data.context.slot);
      for (const account of response.data.value) {
        const parsed = parseTokenAccount(
          account.pubkey,
          decodeAccountData(account.account.data),
        );
        if (parsed.rawAmount > 0n) {
          holders.push(parsed);
        }
      }
    } catch (error) {
      warnings.push(
        `${endpoint.name}:${programId} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (holders.length === 0) {
    throw new Error(
      warnings.length > 0
        ? warnings.join(' | ')
        : `${endpoint.name} returned no token accounts`,
    );
  }

  return {
    holders,
    slot,
    source: `${endpoint.name}:getProgramAccounts`,
    warnings,
  };
}

async function fallbackLargestAccounts(
  totalSupply: bigint,
  decimals: number,
  previousError: string,
): Promise<HolderScanResult> {
  const largest = await callRpc<LargestAccountsResult>('getTokenLargestAccounts', [
    config.tokenMint,
    { commitment: 'confirmed' },
  ]);
  const addresses = largest.data.value.map((account) => account.address);

  if (addresses.length === 0) {
    return {
      holders: [],
      totalSupply,
      decimals,
      slot: largest.data.context.slot,
      status: 'partial',
      source: `${largest.endpoint}:getTokenLargestAccounts`,
      error: previousError,
    };
  }

  const accounts = await callRpc<MultipleAccountsResult>('getMultipleAccounts', [
    addresses,
    { encoding: 'base64', commitment: 'confirmed' },
  ]);

  const holders = accounts.data.value.flatMap((account, index) => {
    if (!account) {
      return [];
    }

    return [
      parseTokenAccount(addresses[index], decodeAccountData(account.data)),
    ];
  });

  return {
    holders,
    totalSupply,
    decimals,
    slot: Math.max(largest.data.context.slot, accounts.data.context.slot),
    status: 'partial',
    source: `${largest.endpoint}:getTokenLargestAccounts+${accounts.endpoint}:getMultipleAccounts`,
    error: previousError,
  };
}

export async function scanTokenHolders(): Promise<HolderScanResult> {
  const supply = await getTokenSupply();
  const endpoints = requireRpcEndpoints();
  const errors: string[] = [];

  try {
    return await scanDasTokenAccounts(supply.totalSupply, supply.decimals);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  for (const endpoint of endpoints) {
    try {
      const result = await scanEndpoint(endpoint);
      return {
        holders: result.holders,
        totalSupply: supply.totalSupply,
        decimals: supply.decimals,
        slot: Math.max(result.slot || 0, supply.slot || 0) || null,
        status: 'complete',
        source: `${result.source};${supply.source}`,
        error: result.warnings.length > 0 ? result.warnings.join(' | ') : undefined,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return fallbackLargestAccounts(
    supply.totalSupply,
    supply.decimals,
    errors.join(' | '),
  );
}
