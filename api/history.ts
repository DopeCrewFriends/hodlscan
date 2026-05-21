import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getHistoryResponse, serializeError } from '../server/handlers.js';

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  try {
    res.status(200).json(await getHistoryResponse());
  } catch (error) {
    const serialized = serializeError(error);
    res.status(serialized.status).json(serialized.body);
  }
}
