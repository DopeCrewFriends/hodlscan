import type { VercelRequest, VercelResponse } from '@vercel/node';

import { refreshSnapshotResponse, serializeError } from '../server/handlers.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    res.status(200).json(
      await refreshSnapshotResponse({
        authorization: req.headers.authorization,
        refreshSecret: req.headers['x-hodlscan-refresh-secret'] as
          | string
          | undefined,
      }),
    );
  } catch (error) {
    const serialized = serializeError(error);
    res.status(serialized.status).json(serialized.body);
  }
}
