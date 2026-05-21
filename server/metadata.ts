import { PublicKey } from '@solana/web3.js';

import { config } from './config.js';
import { callRpc } from './rpc.js';
import type { TokenMetadata } from './types.js';

const METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
);

interface AccountInfoResult {
  context: { slot: number };
  value: {
    data: [string, string] | string;
  } | null;
}

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

function readBorshString(data: Buffer, offset: number) {
  const length = data.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  return {
    value: data.subarray(start, end).toString('utf8').replace(/\0/g, '').trim(),
    offset: end,
  };
}

function parseMetaplexMetadata(data: Buffer) {
  let offset = 1 + 32 + 32;
  const name = readBorshString(data, offset);
  offset = name.offset;
  const symbol = readBorshString(data, offset);
  offset = symbol.offset;
  const uri = readBorshString(data, offset);

  return {
    name: name.value || null,
    symbol: symbol.value || null,
    uri: uri.value || null,
  };
}

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

async function getDasMetadata(previousError?: string): Promise<TokenMetadata> {
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
    error: previousError,
  };
}

export async function getTokenMetadata(
  forceRefresh = false,
): Promise<TokenMetadata> {
  if (metadataCache && !forceRefresh) {
    return metadataCache;
  }

  try {
    const mint = new PublicKey(config.tokenMint);
    const [metadataAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      METADATA_PROGRAM_ID,
    );

    const account = await callRpc<AccountInfoResult>('getAccountInfo', [
      metadataAddress.toBase58(),
      { encoding: 'base64', commitment: 'confirmed' },
    ]);

    if (!account.data.value) {
      throw new Error('Metaplex metadata account not found');
    }

    const rawData = Array.isArray(account.data.value.data)
      ? account.data.value.data[0]
      : account.data.value.data;
    const onchain = parseMetaplexMetadata(Buffer.from(rawData, 'base64'));
    const offchain = await fetchOffchainMetadata(onchain.uri).catch((error) => {
      console.warn(
        `metadata URI fetch failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    });

    metadataCache = {
      mint: config.tokenMint,
      name: offchain?.name || onchain.name,
      symbol: offchain?.symbol || onchain.symbol,
      uri: onchain.uri,
      image: offchain ? extractImage(offchain) : null,
      description: offchain?.description || null,
      source: `${account.endpoint}:metaplex`,
    };
    return metadataCache;
  } catch (error) {
    const metaplexError = error instanceof Error ? error.message : String(error);
    try {
      metadataCache = await getDasMetadata(metaplexError);
      return metadataCache;
    } catch (dasError) {
      const dasMessage =
        dasError instanceof Error ? dasError.message : String(dasError);
      metadataCache = {
        mint: config.tokenMint,
        name: null,
        symbol: null,
        uri: null,
        image: null,
        description: null,
        source: 'none',
        error: `${metaplexError} | getAsset failed: ${dasMessage}`,
      };
      return metadataCache;
    }
  }
}
