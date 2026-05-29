import { config } from './config.js';

const DUNE_BASE = 'https://api.dune.com/api/v1';

export type DuneResultRow = Record<string, unknown>;

interface DuneResultsResponse {
  result?: { rows?: DuneResultRow[] };
  next_uri?: string | null;
  next_offset?: number | null;
}

// Reads the latest cached results of an already-executed saved query. This does
// not re-run the query, so it does not consume execution credits.
export async function fetchDuneQueryResults(
  queryId: number,
): Promise<DuneResultRow[]> {
  if (!config.duneApiKey) {
    throw new Error('DUNE_API_KEY is not set.');
  }

  const rows: DuneResultRow[] = [];
  let url: string | null = `${DUNE_BASE}/query/${queryId}/results?limit=1000`;

  while (url) {
    const response = await fetch(url, {
      headers: { 'X-Dune-API-Key': config.duneApiKey },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Dune request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as DuneResultsResponse;
    const batch = data.result?.rows ?? [];
    rows.push(...batch);

    if (data.next_uri) {
      url = data.next_uri;
    } else if (data.next_offset != null) {
      url = `${DUNE_BASE}/query/${queryId}/results?limit=1000&offset=${data.next_offset}`;
    } else {
      url = null;
    }
  }

  return rows;
}
