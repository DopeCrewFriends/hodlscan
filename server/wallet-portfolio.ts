import { config, requireRpcEndpoints } from './config.js';
import { callRpcOnEndpoint } from './rpc.js';
import type {
  RpcEndpoint,
  WalletPortfolio,
  WalletPortfolioToken,
} from './types.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

interface DasPriceInfo {
  price_per_token?: number;
  total_price?: number;
  currency?: string;
}

interface DasTokenInfo {
  balance?: number;
  decimals?: number;
  symbol?: string;
  price_info?: DasPriceInfo;
}

interface DasAsset {
  id: string;
  interface?: string;
  content?: {
    metadata?: { name?: string; symbol?: string };
    links?: { image?: string };
    files?: { uri?: string; cdn_uri?: string }[];
  };
  token_info?: DasTokenInfo;
}

interface DasNativeBalance {
  lamports?: number;
  price_per_sol?: number;
  total_price?: number;
}

interface GetAssetsByOwnerResult {
  items?: DasAsset[];
  nativeBalance?: DasNativeBalance;
  total?: number;
}

const FUNGIBLE_INTERFACES = new Set(['FungibleToken', 'FungibleAsset']);

function findDasEndpoint(): RpcEndpoint {
  const endpoints = requireRpcEndpoints();
  const helius = endpoints.find((endpoint) => endpoint.name.startsWith('helius'));
  return helius || endpoints[0];
}

function resolveImage(asset: DasAsset): string | null {
  const linkImage = asset.content?.links?.image;
  if (linkImage) {
    return linkImage;
  }
  const file = asset.content?.files?.find((entry) => entry.cdn_uri || entry.uri);
  return file?.cdn_uri || file?.uri || null;
}

function mapAsset(asset: DasAsset, trackedMint: string): WalletPortfolioToken | null {
  if (asset.interface && !FUNGIBLE_INTERFACES.has(asset.interface)) {
    return null;
  }

  const tokenInfo = asset.token_info;
  const decimals = tokenInfo?.decimals ?? 0;
  const rawBalance = tokenInfo?.balance ?? 0;
  if (!rawBalance) {
    return null;
  }

  const uiAmount = decimals > 0 ? rawBalance / 10 ** decimals : rawBalance;
  const priceUsd = tokenInfo?.price_info?.price_per_token ?? null;
  const valueUsd =
    tokenInfo?.price_info?.total_price ??
    (priceUsd != null ? uiAmount * priceUsd : null);

  return {
    mint: asset.id,
    name: asset.content?.metadata?.name || null,
    symbol: tokenInfo?.symbol || asset.content?.metadata?.symbol || null,
    image: resolveImage(asset),
    decimals,
    uiAmount,
    priceUsd,
    valueUsd,
    isTracked: asset.id === trackedMint,
  };
}

export async function fetchWalletPortfolio(
  owner: string,
): Promise<WalletPortfolio> {
  const endpoint = findDasEndpoint();
  const { data } = await callRpcOnEndpoint<GetAssetsByOwnerResult>(
    endpoint,
    'getAssetsByOwner',
    {
      ownerAddress: owner,
      page: 1,
      limit: 1000,
      displayOptions: {
        showFungible: true,
        showNativeBalance: true,
      },
    },
  );

  const tokens = (data.items || [])
    .map((asset) => mapAsset(asset, config.tokenMint))
    .filter((token): token is WalletPortfolioToken => token !== null)
    .sort((left, right) => (right.valueUsd ?? 0) - (left.valueUsd ?? 0));

  const solBalance = (data.nativeBalance?.lamports ?? 0) / LAMPORTS_PER_SOL;
  const solValueUsd = data.nativeBalance?.total_price ?? null;
  const tokensValue = tokens.reduce(
    (sum, token) => sum + (token.valueUsd ?? 0),
    0,
  );

  return {
    owner,
    solBalance,
    solValueUsd,
    totalValueUsd: tokensValue + (solValueUsd ?? 0),
    tokenCount: tokens.length,
    tokens,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}
