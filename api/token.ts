import type { VercelRequest, VercelResponse } from '@vercel/node';

import { config } from '../server/config.js';
import { getTokenMetadata } from '../server/metadata.js';

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const metadata = await getTokenMetadata();
    res.status(200).json({
      mint: config.tokenMint,
      endpoints: config.rpcEndpoints.map((endpoint) => endpoint.name),
      maxDisplayHolders: config.maxDisplayHolders,
      metadata,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
