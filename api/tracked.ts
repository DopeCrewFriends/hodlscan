import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getTrackedCoinsResponse } from '../server/handlers.js';
import { handleApiResponse } from './_utils.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  await handleApiResponse(res, () => getTrackedCoinsResponse());
}
