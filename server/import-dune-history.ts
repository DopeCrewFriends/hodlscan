import { config, isSupabaseConfigured } from './config.js';
import {
  deleteHolderCountHistoryBefore,
  getEarliestHistoryDate,
  initDb,
  insertHolderCountHistoryRows,
} from './db.js';
import { fetchDuneQueryResults, type DuneResultRow } from './dune.js';

interface ImportRow {
  mint: string;
  holder_count: number;
  scanned_at: string;
}

function getFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function parseDay(value: unknown): string | null {
  const match = String(value ?? '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z` : null;
}

function parseHolders(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : null;
}

function pickColumn(row: DuneResultRow, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const hit = keys.find((key) => key.toLowerCase() === candidate);
    if (hit) return hit;
  }
  // fall back to fuzzy contains match
  for (const candidate of candidates) {
    const hit = keys.find((key) => key.toLowerCase().includes(candidate));
    if (hit) return hit;
  }
  return undefined;
}

async function main() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  if (!config.duneApiKey) {
    throw new Error('DUNE_API_KEY is not set. Add it to your .env file.');
  }

  const queryIdRaw = getFlag('query-id');
  if (!queryIdRaw) {
    throw new Error(
      'Provide a Dune query id: npm run import:history:dune -- --query-id=1234567',
    );
  }
  const queryId = Number(queryIdRaw);
  if (!Number.isInteger(queryId)) {
    throw new Error(`Invalid query id: ${queryIdRaw}`);
  }

  initDb();

  const mint = config.tokenMint;
  const dryRun = process.argv.includes('--dry-run');
  const purgeBefore = getFlag('purge-before');

  console.log(`Fetching results for Dune query ${queryId}...`);
  const rawRows = await fetchDuneQueryResults(queryId);
  console.log(`Dune returned ${rawRows.length} row(s).`);
  if (rawRows.length === 0) {
    console.log('No rows to import.');
    return;
  }

  const dayKey = pickColumn(rawRows[0], ['day', 'date', 'block_date']);
  const holderKey = pickColumn(rawRows[0], ['holders', 'holder_count', 'count']);
  if (!dayKey || !holderKey) {
    throw new Error(
      `Could not find day/holders columns. Available: ${Object.keys(rawRows[0]).join(', ')}`,
    );
  }
  console.log(`Using columns: day="${dayKey}", holders="${holderKey}".`);

  // Raw preview (independent of cutoff) so we can sanity-check the data.
  const parsed = rawRows
    .map((row) => ({
      day: parseDay(row[dayKey]),
      holders: parseHolders(row[holderKey]),
    }))
    .filter(
      (entry): entry is { day: string; holders: number } =>
        entry.day != null && entry.holders != null,
    )
    .sort((left, right) => left.day.localeCompare(right.day));
  if (parsed.length > 0) {
    const first = parsed[0];
    const last = parsed[parsed.length - 1];
    const peak = parsed.reduce((best, e) => (e.holders > best.holders ? e : best));
    console.log(
      `Raw Dune data: ${parsed.length} day(s), ${first.day} (${first.holders}) -> ${last.day} (${last.holders}); peak ${peak.holders} on ${peak.day.slice(0, 10)}.`,
    );
  }

  if (purgeBefore) {
    if (dryRun) {
      console.log(`(dry run) would purge rows before ${purgeBefore}.`);
    } else {
      const removed = await deleteHolderCountHistoryBefore(mint, purgeBefore);
      console.log(`Purged ${removed} existing row(s) before ${purgeBefore}.`);
    }
  }

  const earliest = await getEarliestHistoryDate(mint);
  const cutoffMs = earliest
    ? new Date(earliest).getTime()
    : Number.POSITIVE_INFINITY;
  if (earliest) {
    console.log(
      `Existing history starts at ${earliest}. Importing only days before that.`,
    );
  } else {
    console.log('No existing history found. Importing all rows.');
  }

  const byDay = new Map<string, ImportRow>();
  let skipped = 0;
  for (const row of rawRows) {
    const scannedAt = parseDay(row[dayKey]);
    const holders = parseHolders(row[holderKey]);
    if (!scannedAt || holders == null || holders < 0) {
      skipped += 1;
      continue;
    }
    if (new Date(scannedAt).getTime() >= cutoffMs) {
      continue;
    }
    byDay.set(scannedAt.slice(0, 10), {
      mint,
      holder_count: holders,
      scanned_at: scannedAt,
    });
  }

  const rows = [...byDay.values()].sort((left, right) =>
    left.scanned_at.localeCompare(right.scanned_at),
  );

  console.log(
    `Prepared ${rows.length} daily row(s) to import, ${skipped} skipped.`,
  );
  if (rows.length > 0) {
    console.log(
      `  range: ${rows[0].scanned_at.slice(0, 10)} -> ${rows[rows.length - 1].scanned_at.slice(0, 10)}`,
    );
    console.log(
      `  first: ${rows[0].holder_count} holders, last: ${rows[rows.length - 1].holder_count} holders`,
    );
  }

  if (dryRun) {
    console.log('Dry run enabled - skipping insert.');
    return;
  }
  if (rows.length === 0) {
    console.log('Nothing to import.');
    return;
  }

  const inserted = await insertHolderCountHistoryRows(rows);
  console.log(`Inserted ${inserted} row(s) from Dune. Done.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
