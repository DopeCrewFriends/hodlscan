import { config } from './config.js';
import { callRpc } from './rpc.js';
import type { TokenMetadata } from './types.js';

interface OffchainMetadata {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  image_url?: string;
  properties?: {
    files?: Array<{ uri?: string; type?: string }>;
  };
}

interface DasAssetResult {
  id: string;
  content?: {
    json_uri?: string;
    metadata?: {
      name?: string;
      symbol?: string;
      description?: string;
    };
    links?: {
      image?: string;
      external_url?: string;
    };
    files?: Array<{
      uri?: string;
      cdn_uri?: string;
      mime?: string;
    }>;
  };
}

let metadataCache: TokenMetadata | null = null;

function normalizeIpfsUrl(uri: string) {
  if (uri.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${uri.replace('ipfs://', '')}`;
  }

  return uri;
}

function extractImage(metadata: OffchainMetadata) {
  if (metadata.image) {
    return normalizeIpfsUrl(metadata.image);
  }

  if (metadata.image_url) {
    return normalizeIpfsUrl(metadata.image_url);
  }

  const imageFile = metadata.properties?.files?.find((file) =>
    file.type?.startsWith('image/'),
  );
  return imageFile?.uri ? normalizeIpfsUrl(imageFile.uri) : null;
}

async function fetchOffchainMetadata(uri: string | null) {
  if (!uri) {
    return null;
  }

  const response = await fetch(normalizeIpfsUrl(uri), {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`metadata URI HTTP ${response.status}`);
  }

  return (await response.json()) as OffchainMetadata;
}

function extractDasImage(asset: DasAssetResult) {
  const linkedImage = asset.content?.links?.image;
  if (linkedImage) {
    return normalizeIpfsUrl(linkedImage);
  }

  const imageFile = asset.content?.files?.find((file) =>
    file.mime?.startsWith('image/'),
  );
  if (imageFile?.cdn_uri) {
    return normalizeIpfsUrl(imageFile.cdn_uri);
  }
  if (imageFile?.uri) {
    return normalizeIpfsUrl(imageFile.uri);
  }

  return null;
}

async function getDasMetadata(): Promise<TokenMetadata> {
  const asset = await callRpc<DasAssetResult>('getAsset', {
    id: config.tokenMint,
    options: {
      showFungible: true,
      showUnverifiedCollections: true,
      showCollectionMetadata: true,
    },
  });
  const content = asset.data.content;
  const offchain = await fetchOffchainMetadata(content?.json_uri || null).catch(
    () => null,
  );

  return {
    mint: config.tokenMint,
    name: offchain?.name || content?.metadata?.name || null,
    symbol: offchain?.symbol || content?.metadata?.symbol || null,
    uri: content?.json_uri || null,
    image: offchain ? extractImage(offchain) : extractDasImage(asset.data),
    description: offchain?.description || content?.metadata?.description || null,
    source: `${asset.endpoint}:getAsset`,
  };
}

export async function getTokenMetadata(
  forceRefresh = false,
): Promise<TokenMetadata> {
  if (metadataCache && !forceRefresh) {
    return metadataCache;
  }

  try {
    metadataCache = await getDasMetadata();
    return metadataCache;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    metadataCache = {
      mint: config.tokenMint,
      name: null,
      symbol: null,
      uri: null,
      image: null,
      description: null,
      source: 'none',
      error: `getAsset failed: ${message}`,
    };
    return metadataCache;
  }
}
