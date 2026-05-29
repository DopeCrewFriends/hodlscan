import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getHoldersResponse } from '../server/handlers.js';
import { apiHeaders, handleApiResponse } from './_utils.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  await handleApiResponse(res, async () => {
    const mint = typeof req.query.mint === 'string' ? req.query.mint : undefined;
    return getHoldersResponse(mint, apiHeaders(req));
  });
}
