import { readFileSync } from 'node:fs';

import { config, isSupabaseConfigured } from './config.js';
import {
  deleteHolderCountHistoryBefore,
  getEarliestHistoryDate,
  initDb,
  insertHolderCountHistoryRows,
} from './db.js';

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

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseDay(value: string): string | null {
  const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
}

function parseHolders(value: string): number | null {
  const cleaned = value.replace(/[",]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.round(num) : null;
}

async function main() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  const file = getFlag('file');
  if (!file) {
    throw new Error(
      'Provide a CSV file: npm run import:history -- --file=path/to/dune.csv',
    );
  }

  initDb();

  const mint = config.tokenMint;
  const dryRun = process.argv.includes('--dry-run');
  const purgeBefore = getFlag('purge-before');

  const raw = readFileSync(file, 'utf8').trim();
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error('CSV file is empty.');
  }

  // Detect header and resolve which columns hold the day and holder count.
  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const hasHeader = header.some(
    (cell) => cell.includes('day') || cell.includes('date') || cell.includes('holder'),
  );
  let dayIdx = 0;
  let holderIdx = 1;
  if (hasHeader) {
    const foundDay = header.findIndex(
      (cell) => cell.includes('day') || cell.includes('date'),
    );
    const foundHolder = header.findIndex((cell) => cell.includes('holder'));
    if (foundDay >= 0) dayIdx = foundDay;
    if (foundHolder >= 0) holderIdx = foundHolder;
  }
  const dataLines = hasHeader ? lines.slice(1) : lines;

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
    console.log('No existing history found. Importing all CSV rows.');
  }

  const byDay = new Map<string, ImportRow>();
  let skipped = 0;
  for (const line of dataLines) {
    const cells = splitCsvLine(line);
    const scannedAt = parseDay(cells[dayIdx] ?? '');
    const holders = parseHolders(cells[holderIdx] ?? '');
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
    `Parsed ${dataLines.length} line(s): ${rows.length} row(s) to import, ${skipped} unparseable.`,
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
  console.log(`Inserted ${inserted} row(s) from CSV. Done.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
