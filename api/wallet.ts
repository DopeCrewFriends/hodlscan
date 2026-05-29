import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getWalletPortfolioResponse, serializeError } from '../server/handlers.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const address = Array.isArray(req.query.address)
      ? req.query.address[0]
      : req.query.address;
    res.status(200).json(await getWalletPortfolioResponse(address));
  } catch (error) {
    const serialized = serializeError(error);
    res.status(serialized.status).json(serialized.body);
  }
}
