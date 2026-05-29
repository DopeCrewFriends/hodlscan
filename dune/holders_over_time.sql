-- hodlscan: daily holder count over time for a Solana SPL token.
--
-- Run this in the Dune query editor (https://dune.com), then export the
-- result as CSV and import it with:  npm run import:history -- --file=path/to.csv
--
-- PERFORMANCE: this token is very active, so the free engine's 2-minute limit
-- can be tight. Two levers if it times out:
--   1. Use the engine dropdown (arrow next to "Run") and pick "Medium" - it has
--      a much longer timeout and only costs a few credits for a one-off.
--   2. Narrow `start_date` (the token launched in 2026) so fewer partitions scan.
--
-- This version scans tokens_solana.transfers ONLY ONCE (via UNNEST) and then
-- reconstructs each owner's running balance, detects when they cross into / out
-- of "holding", and cumulatively sums those transitions per day.

WITH params AS (
    SELECT
        'Hh3oTaqDCKKfdBgsQEvxp9sUwyNf8x9qmKqEMLBWpump' AS mint,
        DATE '2026-02-11' AS start_date  -- token launched 2026-02-12 (day before = safety margin)
),

-- Single scan of the transfers table for this mint.
base AS (
    SELECT
        block_date,
        from_owner,
        to_owner,
        CAST(amount AS DECIMAL(38, 0)) AS amt
    FROM tokens_solana.transfers, params
    WHERE token_mint_address = params.mint
      AND block_date >= params.start_date
),

-- Fan each transfer into two signed rows (in to to_owner, out of from_owner)
-- without re-reading the table.
deltas AS (
    SELECT
        e.owner,
        base.block_date,
        CASE WHEN e.sign = 1 THEN base.amt ELSE -base.amt END AS delta
    FROM base
    CROSS JOIN UNNEST(ARRAY[
        ROW(base.to_owner, 1),
        ROW(base.from_owner, -1)
    ]) AS e (owner, sign)
    WHERE e.owner IS NOT NULL
),

-- Net change per owner per day.
daily_owner AS (
    SELECT owner, block_date, SUM(delta) AS day_delta
    FROM deltas
    GROUP BY owner, block_date
),

-- Running balance per owner across the days they were active.
running AS (
    SELECT
        owner,
        block_date,
        SUM(day_delta) OVER (
            PARTITION BY owner
            ORDER BY block_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS balance
    FROM daily_owner
),

-- Holder-count transitions: +1 when an owner starts holding, -1 when they exit.
transitions AS (
    SELECT
        block_date,
        SUM(
            CASE
                WHEN COALESCE(prev_balance, 0) <= 0 AND balance > 0 THEN 1
                WHEN COALESCE(prev_balance, 0) > 0 AND balance <= 0 THEN -1
                ELSE 0
            END
        ) AS holder_change
    FROM (
        SELECT
            owner,
            block_date,
            balance,
            LAG(balance) OVER (PARTITION BY owner ORDER BY block_date) AS prev_balance
        FROM running
    ) s
    GROUP BY block_date
)

SELECT
    block_date AS day,
    SUM(holder_change) OVER (
        ORDER BY block_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS holders
FROM transitions
ORDER BY day;
