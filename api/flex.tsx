import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const BG = '#050608';
const PANEL = '#0f141b';
const BORDER = '#1f2935';
const GREEN = '#44f0a2';
const AMBER = '#ffcc66';
const MUTED = '#6c7685';
const TEXT = '#e9eef5';

const DIST_LABELS = ['Top 10', 'Top 50', 'Top 100', 'Top 250', 'Top 500'];

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

function parseNumberList(raw: string | null) {
  return (raw || '').split(',').map((value) => {
    const parsed = Number(value);
    return value.trim() !== '' && Number.isFinite(parsed) ? parsed : null;
  });
}

function parseDist(distRaw: string | null, ageRaw: string | null) {
  if (!distRaw) {
    return [];
  }
  const ages = parseNumberList(ageRaw);
  return distRaw
    .split(',')
    .map((value, index) => {
      const pct = Number(value);
      if (value.trim() === '' || !Number.isFinite(pct) || !DIST_LABELS[index]) {
        return null;
      }
      return { label: DIST_LABELS[index], pct, ageDays: ages[index] ?? null };
    })
    .filter(
      (entry): entry is { label: string; pct: number; ageDays: number | null } =>
        entry !== null,
    );
}

export default function handler(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol') || 'HODL';
  const holders = searchParams.get('holders');
  const diamondPct = searchParams.get('diamondPct');
  const avgHold = formatDays(searchParams.get('avgHoldDays'));
  const oldest = formatDays(searchParams.get('oldestDays'));
  const price = formatPrice(searchParams.get('price'));
  const distribution = parseDist(
    searchParams.get('dist'),
    searchParams.get('age'),
  );
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const stats = [
    holders ? { label: 'Total hodlers', value: holders } : null,
    diamondPct ? { label: 'Diamond hands', value: `${diamondPct}%` } : null,
    avgHold ? { label: 'Avg hodl time', value: avgHold } : null,
    oldest ? { label: 'Oldest hodler', value: oldest } : null,
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
          padding: '52px 64px',
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
            <span style={{ fontSize: '40px', fontWeight: 800, letterSpacing: '6px' }}>
              HODL
            </span>
            <span
              style={{
                fontSize: '40px',
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
              fontSize: '24px',
              fontWeight: 700,
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: MUTED,
            }}
          >
            hodler analytics
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '26px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span
              style={{
                fontSize: '88px',
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
                  marginLeft: '26px',
                  fontSize: '38px',
                  fontWeight: 700,
                  color: AMBER,
                }}
              >
                {price}
              </span>
            ) : null}
          </div>

          {stats.length ? (
            <div style={{ display: 'flex', gap: '18px' }}>
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    flex: '1 1 0',
                    gap: '8px',
                    padding: '20px 24px',
                    background: PANEL,
                    border: `1px solid ${BORDER}`,
                    borderRadius: '18px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '17px',
                      letterSpacing: '2px',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                      color: MUTED,
                    }}
                  >
                    {stat.label}
                  </span>
                  <span style={{ fontSize: '40px', fontWeight: 800 }}>
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {distribution.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <span
                style={{
                  display: 'flex',
                  fontSize: '17px',
                  letterSpacing: '2px',
                  textTransform: 'uppercase',
                  color: MUTED,
                }}
              >
                Supply concentration
              </span>
              {distribution.map((entry) => (
                <div
                  key={entry.label}
                  style={{ display: 'flex', alignItems: 'center', gap: '18px' }}
                >
                  <span
                    style={{
                      display: 'flex',
                      width: '92px',
                      fontSize: '22px',
                      fontWeight: 700,
                    }}
                  >
                    {entry.label}
                  </span>
                  <div
                    style={{
                      display: 'flex',
                      flex: '1 1 0',
                      height: '16px',
                      background: 'rgba(255,255,255,0.06)',
                      borderRadius: '8px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        width: `${Math.max(0, Math.min(100, entry.pct)).toFixed(2)}%`,
                        height: '16px',
                        background: `linear-gradient(90deg, #18845f, ${GREEN})`,
                        borderRadius: '8px',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      width: '88px',
                      fontSize: '22px',
                      fontWeight: 800,
                      color: GREEN,
                    }}
                  >
                    {entry.pct.toFixed(2)}%
                  </span>
                  <span
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      width: '78px',
                      fontSize: '22px',
                      fontWeight: 700,
                      color: MUTED,
                    }}
                  >
                    {entry.ageDays != null ? `${entry.ageDays.toFixed(1)}d` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '6px',
            borderTop: `1px solid ${BORDER}`,
            fontSize: '20px',
            color: MUTED,
          }}
        >
          <span style={{ display: 'flex', fontWeight: 700, letterSpacing: '1px' }}>
            hodlscan
          </span>
          <span style={{ display: 'flex' }}>{today}</span>
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
