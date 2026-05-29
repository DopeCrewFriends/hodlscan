import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const BG = '#050608';
const PANEL = '#0f141b';
const BORDER = '#1f2935';
const GREEN = '#44f0a2';
const AMBER = '#ffcc66';
const MUTED = '#6c7685';
const TEXT = '#e9eef5';

function formatDays(daysRaw: string | null) {
  const days = Number(daysRaw);
  if (!daysRaw || !Number.isFinite(days)) {
    return null;
  }
  if (days < 1) {
    return `${Math.max(0, Math.round(days * 24))}h`;
  }
  return `${days.toFixed(1)}d`;
}

function formatPrice(priceRaw: string | null) {
  const price = Number(priceRaw);
  if (!priceRaw || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  if (price >= 1) {
    return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  const digits = Math.min(8, Math.max(2, Math.ceil(-Math.log10(price)) + 2));
  return `$${price.toFixed(digits)}`;
}

export default function handler(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol') || 'HODL';
  const holders = searchParams.get('holders');
  const diamondPct = searchParams.get('diamondPct');
  const avgHold = formatDays(searchParams.get('avgHoldDays'));
  const oldest = formatDays(searchParams.get('oldestDays'));
  const price = formatPrice(searchParams.get('price'));
  const topSupplyPct = searchParams.get('topSupplyPct');

  const stats = [
    holders ? { label: 'Total hodlers', value: holders } : null,
    diamondPct ? { label: 'Diamond hands', value: `${diamondPct}%` } : null,
    avgHold ? { label: 'Avg hodl time', value: avgHold } : null,
    oldest ? { label: 'Oldest hodler', value: oldest } : null,
    price ? { label: 'Price', value: price } : null,
    topSupplyPct ? { label: 'Top 10 supply', value: `${topSupplyPct}%` } : null,
  ].filter((stat): stat is { label: string; value: string } => stat !== null);

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px',
          background: `radial-gradient(circle at top left, rgba(68,240,162,0.14), transparent 55%), linear-gradient(160deg, #07090d 0%, ${BG} 100%)`,
          color: TEXT,
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{ fontSize: '44px', fontWeight: 800, letterSpacing: '6px' }}>
              HODL
            </span>
            <span
              style={{
                fontSize: '44px',
                fontWeight: 800,
                letterSpacing: '6px',
                color: GREEN,
              }}
            >
              SCAN
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: '26px',
              fontWeight: 700,
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: MUTED,
            }}
          >
            hodler analytics
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span
            style={{
              fontSize: '116px',
              fontWeight: 800,
              letterSpacing: '-3px',
              color: GREEN,
            }}
          >
            ${symbol}
          </span>
          {price ? (
            <span
              style={{
                display: 'flex',
                marginLeft: '28px',
                fontSize: '40px',
                fontWeight: 700,
                color: AMBER,
              }}
            >
              {price}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
          {stats.map((stat) => (
            <div
              key={stat.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: '1 1 0',
                minWidth: '180px',
                gap: '10px',
                padding: '26px 30px',
                background: PANEL,
                border: `1px solid ${BORDER}`,
                borderRadius: '18px',
              }}
            >
              <span
                style={{
                  fontSize: '20px',
                  letterSpacing: '2px',
                  textTransform: 'uppercase',
                  color: MUTED,
                }}
              >
                {stat.label}
              </span>
              <span style={{ fontSize: '44px', fontWeight: 800 }}>{stat.value}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        'cache-control': 'public, max-age=3600, s-maxage=3600',
      },
    },
  );
}
