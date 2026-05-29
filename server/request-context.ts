import type { IncomingHttpHeaders } from 'node:http';

import type { VercelRequest } from '@vercel/node';

import { RateLimitError } from './rate-limit.js';

function normalizeHeaders(
  headers: IncomingHttpHeaders | VercelRequest['headers'],
): Record<string, string | string[] | undefined> {
  return headers as Record<string, string | string[] | undefined>;
}

export function headersFromExpress(
  headers: IncomingHttpHeaders,
): Record<string, string | string[] | undefined> {
  return normalizeHeaders(headers);
}

export function headersFromVercel(
  req: VercelRequest,
): Record<string, string | string[] | undefined> {
  return normalizeHeaders(req.headers);
}

export function serializeRateLimitError(error: unknown) {
  if (error instanceof RateLimitError) {
    return {
      status: 429,
      body: {
        error: error.message,
        retryAfterSeconds: error.retryAfterSeconds,
      },
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  return null;
}
