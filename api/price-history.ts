import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getPriceHistoryResponse, serializeError } from '../server/handlers.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const mint = Array.isArray(req.query.mint)
      ? req.query.mint[0]
      : req.query.mint;
    res.status(200).json(await getPriceHistoryResponse(mint));
  } catch (error) {
    const serialized = serializeError(error);
    res.status(serialized.status).json(serialized.body);
  }
}
