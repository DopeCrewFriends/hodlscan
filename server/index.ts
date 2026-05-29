import path from 'node:path';

import cors from 'cors';
import express from 'express';

import { config, isSupabaseConfigured } from './config.js';
import { initDb } from './db.js';
import {
  getHistoryResponse,
  getHoldersResponse,
  getPriceHistoryResponse,
  getTokenResponse,
  getTrackedCoinsResponse,
  getWalletPortfolioResponse,
  refreshSnapshotResponse,
  runSnapshotRefresh,
  serializeError,
} from './handlers.js';
import {
  headersFromExpress,
  serializeRateLimitError,
} from './request-context.js';

initDb();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/token', async (req, res) => {
  try {
    const mint =
      typeof req.query.mint === 'string' ? req.query.mint : undefined;
    res.json(await getTokenResponse(mint, headersFromExpress(req.headers)));
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
});

app.get('/api/tracked', async (_req, res) => {
  try {
    res.json(await getTrackedCoinsResponse());
  } catch (error) {
    const serialized = serializeError(error);
    res.status(serialized.status).json(serialized.body);
  }
});

app.get('/api/holders', async (req, res) => {
  try {
    const mint =
      typeof req.query.mint === 'string' ? req.query.mint : undefined;
    res.json(await getHoldersResponse(mint, headersFromExpress(req.headers)));
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
});

app.get('/api/history', async (req, res) => {
  try {
    const mint =
      typeof req.query.mint === 'string' ? req.query.mint : undefined;
    res.json(await getHistoryResponse(mint, headersFromExpress(req.headers)));
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
});

app.get('/api/price-history', async (req, res) => {
  try {
    const mint =
      typeof req.query.mint === 'string' ? req.query.mint : undefined;
    res.json(await getPriceHistoryResponse(mint));
  } catch (error) {
    const serialized = serializeError(error);
    res.status(serialized.status).json(serialized.body);
  }
});

app.get('/api/wallet', async (req, res) => {
  try {
    const address =
      typeof req.query.address === 'string' ? req.query.address : undefined;
    res.json(await getWalletPortfolioResponse(address));
  } catch (error) {
    const serialized = serializeError(error);
    res.status(serialized.status).json(serialized.body);
  }
});

app.post('/api/refresh', async (req, res) => {
  try {
    res.json(
      await refreshSnapshotResponse({
        authorization: req.header('authorization') || undefined,
        refreshSecret: req.header('x-hodlscan-refresh-secret') || undefined,
        vercelCron: req.header('x-vercel-cron') || undefined,
      }),
    );
  } catch (error) {
    const serialized = serializeError(error);
    res.status(serialized.status).json(serialized.body);
  }
});

let localRefreshRunning = false;
async function runLocalAutoRefresh() {
  if (localRefreshRunning) {
    return;
  }

  localRefreshRunning = true;
  try {
    const refreshed = await runSnapshotRefresh();
    console.log(
      `auto refresh snapshot #${refreshed.snapshot?.id} (${refreshed.metrics?.holderCount} holders)`,
    );
  } catch (error) {
    console.error(
      `auto refresh failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    localRefreshRunning = false;
  }
}

if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(config.rootDir, 'dist');
  app.use(express.static(distDir));
  app.use((_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(config.port, () => {
  console.log(`hodlscan api listening on http://localhost:${config.port}`);
  console.log(`tracking mint ${config.tokenMint}`);
  console.log(
    `rpc endpoints: ${
      config.rpcEndpoints.map((endpoint) => endpoint.name).join(', ') || 'none'
    }`,
  );
  if (!process.env.VERCEL && !config.disableLocalAutoRefresh) {
    if (isSupabaseConfigured() && config.rpcEndpoints.length > 0) {
      console.log(`local auto refresh every ${config.autoRefreshMs / 1000}s`);
      setInterval(() => {
        void runLocalAutoRefresh();
      }, config.autoRefreshMs);
    } else {
      console.log(
        'local auto refresh disabled: set Supabase and RPC env vars in .env',
      );
    }
  }
});
