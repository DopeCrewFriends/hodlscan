import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getTokenResponse, serializeError } from '../server/handlers.js';

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  try {
    res.status(200).json(await getTokenResponse());
  } catch (error) {
    const serialized = serializeError(error);
    res.status(serialized.status).json(serialized.body);
  }
}
