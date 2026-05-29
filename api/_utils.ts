import type { VercelRequest, VercelResponse } from '@vercel/node';

import { serializeError } from '../server/handlers.js';
import {
  headersFromVercel,
  serializeRateLimitError,
} from '../server/request-context.js';

export async function handleApiResponse(
  res: VercelResponse,
  handler: () => Promise<unknown>,
) {
  try {
    res.status(200).json(await handler());
  } catch (error) {
    const rateLimited = serializeRateLimitError(error);
    if (rateLimited) {
      res.setHeader('Retry-After', String(rateLimited.retryAfterSeconds));
      res.status(rateLimited.status).json(rateLimited.body);
      return;
    }

    const serialized = serializeError(error);
    res.status(serialized.status).json(serialized.body);
  }
}

export function apiHeaders(req: VercelRequest) {
  return headersFromVercel(req);
}
