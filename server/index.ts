import path from 'node:path';

import cors from 'cors';
import express from 'express';

import { config } from './config.js';
import { initDb } from './db.js';
import {
  getHistoryResponse,
  getHoldersResponse,
  getTokenResponse,
  refreshSnapshotResponse,
  runSnapshotRefresh,
  serializeError,
} from './handlers.js';

initDb();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/token', async (_req, res) => {
  res.json(await getTokenResponse());
});

app.get('/api/holders', async (_req, res) => {
  res.json(await getHoldersResponse());
});

app.get('/api/history', async (_req, res) => {
  res.json(await getHistoryResponse());
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
    console.log(`local auto refresh every ${config.autoRefreshMs / 1000}s`);
    setInterval(() => {
      void runLocalAutoRefresh();
    }, config.autoRefreshMs);
  }
});
