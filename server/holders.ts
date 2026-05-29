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

interface ProgramAccountsV2Account {
  pubkey: string;
  account: {
    data: [string, string] | string;
  };
}

interface ProgramAccountsV2Result {
  context?: { slot: number };
  value?: {
    accounts: ProgramAccountsV2Account[];
    paginationKey: string | null;
  };
  accounts?: ProgramAccountsV2Account[];
  paginationKey?: string | null;
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

function programFilters(programId: string, mint: string) {
  return programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    ? [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }]
    : [{ memcmp: { offset: 0, bytes: mint } }];
}

function unwrapProgramAccountsV2(data: ProgramAccountsV2Result) {
  if (data.value?.accounts) {
    return {
      accounts: data.value.accounts,
      paginationKey: data.value.paginationKey ?? null,
      slot: data.context?.slot ?? null,
    };
  }

  return {
    accounts: data.accounts || [],
    paginationKey: data.paginationKey ?? null,
    slot: data.context?.slot ?? null,
  };
}

async function scanProgramAccountsV2(
  endpoint: RpcEndpoint,
  mint: string,
): Promise<{
  holders: TokenAccountHolder[];
  slot: number | null;
  source: string;
}> {
  const holders: TokenAccountHolder[] = [];
  const limit = Number(process.env.GPA_V2_PAGE_LIMIT || 5000);
  const maxPages = Number(process.env.GPA_V2_MAX_PAGES || 200);
  let slot: number | null = null;
  let paginationKey: string | null = null;

  for (const programId of config.tokenPrograms) {
    paginationKey = null;

    for (let page = 0; page < maxPages; page += 1) {
      const response = await callRpcOnEndpoint<ProgramAccountsV2Result>(
        endpoint,
        'getProgramAccountsV2',
        [
          programId,
          {
            encoding: 'base64',
            withContext: page === 0,
            filters: programFilters(programId, mint),
            limit,
            ...(paginationKey ? { paginationKey } : {}),
          },
        ],
      );

      const pageData = unwrapProgramAccountsV2(response.data);
      slot = Math.max(slot || 0, pageData.slot || response.slot || 0) || null;

      for (const account of pageData.accounts) {
        const parsed = parseTokenAccount(
          account.pubkey,
          decodeAccountData(account.account.data),
        );
        if (parsed.rawAmount > 0n) {
          holders.push(parsed);
        }
      }

      if (pageData.accounts.length === 0 || !pageData.paginationKey) {
        break;
      }

      paginationKey = pageData.paginationKey;
    }
  }

  if (holders.length === 0) {
    throw new Error(`${endpoint.name}:getProgramAccountsV2 returned no token accounts`);
  }

  return {
    holders,
    slot,
    source: `${endpoint.name}:getProgramAccountsV2`,
  };
}

async function scanDasTokenAccounts(
  mint: string,
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
      mint,
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

async function getTokenSupply(mint: string) {
  const supply = await callRpc<TokenSupplyResult>('getTokenSupply', [
    mint,
    { commitment: 'confirmed' },
  ]);

  return {
    totalSupply: BigInt(supply.data.value.amount),
    decimals: supply.data.value.decimals,
    slot: supply.data.context.slot,
    source: `${supply.endpoint}:getTokenSupply`,
  };
}

async function scanEndpoint(
  endpoint: RpcEndpoint,
  mint: string,
): Promise<{
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
      const response = await callRpcOnEndpoint<ProgramAccountsResult>(
        endpoint,
        'getProgramAccounts',
        [
          programId,
          {
            encoding: 'base64',
            withContext: true,
            filters: programFilters(programId, mint),
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
  mint: string,
  totalSupply: bigint,
  decimals: number,
  previousError: string,
): Promise<HolderScanResult> {
  const largest = await callRpc<LargestAccountsResult>('getTokenLargestAccounts', [
    mint,
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

export async function scanTokenHolders(mint: string): Promise<HolderScanResult> {
  const supply = await getTokenSupply(mint);
  const endpoints = requireRpcEndpoints();
  const errors: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const result = await scanProgramAccountsV2(endpoint, mint);
      return {
        holders: result.holders,
        totalSupply: supply.totalSupply,
        decimals: supply.decimals,
        slot: Math.max(result.slot || 0, supply.slot || 0) || null,
        status: 'complete',
        source: `${result.source};${supply.source}`,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    return await scanDasTokenAccounts(mint, supply.totalSupply, supply.decimals);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  for (const endpoint of endpoints) {
    try {
      const result = await scanEndpoint(endpoint, mint);
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
    mint,
    supply.totalSupply,
    supply.decimals,
    errors.join(' | '),
  );
}
