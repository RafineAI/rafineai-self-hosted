"use client";

// Dependency-free SVG charts (safe for offline/self-hosted builds).

const PALETTE = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

export function LineChart({
  data,
  height = 200,
  color = "#4f46e5",
  label,
}: {
  data: { x: string; y: number }[];
  height?: number;
  color?: string;
  label?: string;
}) {
  const w = 600;
  const pad = 32;
  const max = Math.max(1, ...data.map((d) => d.y));
  const stepX = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  const pts = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = height - pad - (d.y / max) * (height - pad * 2);
    return [x, y] as const;
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${path} L${pad + (data.length - 1) * stepX},${height - pad} L${pad},${height - pad} Z`;

  return (
    <div className="w-full overflow-x-auto">
      {label && <p className="mb-1 text-sm font-medium text-slate-600 dark:text-slate-300">{label}</p>}
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ minWidth: 320 }}>
        <line x1={pad} y1={height - pad} x2={w - pad} y2={height - pad} className="stroke-slate-200 dark:stroke-slate-700" />
        {data.length > 0 && (
          <>
            <path d={area} fill={color} opacity={0.08} />
            <path d={path} fill="none" stroke={color} strokeWidth={2} />
            {pts.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill={color} />
            ))}
          </>
        )}
        {data.length === 0 && (
          <text x={w / 2} y={height / 2} textAnchor="middle" className="fill-slate-400 text-sm">
            veri yok
          </text>
        )}
      </svg>
    </div>
  );
}

export function BarChart({
  data,
  height = 220,
  label,
}: {
  data: { name: string; value: number }[];
  height?: number;
  label?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="w-full">
      {label && <p className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">{label}</p>}
      <div className="space-y-2">
        {data.length === 0 && <p className="text-sm text-slate-400">veri yok</p>}
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center gap-2">
            <span className="w-40 shrink-0 truncate text-xs text-slate-500 dark:text-slate-400" title={d.name}>{d.name}</span>
            <div className="h-5 flex-1 rounded bg-slate-100 dark:bg-slate-700/50">
              <div
                className="h-5 rounded"
                style={{ width: `${(d.value / max) * 100}%`, background: PALETTE[i % PALETTE.length] }}
              />
            </div>
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">
              {d.value.toLocaleString("tr-TR")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Donut({
  data,
  label,
}: {
  data: { name: string; value: number }[];
  label?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 60;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="w-full">
      {label && <p className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">{label}</p>}
      <div className="flex items-center gap-6">
        <svg viewBox="0 0 160 160" width={150} height={150}>
          <g transform="translate(80,80) rotate(-90)">
            {data.map((d, i) => {
              const frac = d.value / total;
              const dash = frac * c;
              const seg = (
                <circle
                  key={d.name}
                  r={r}
                  fill="none"
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={22}
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return seg;
            })}
          </g>
        </svg>
        <div className="space-y-1">
          {data.map((d, i) => (
            <div key={d.name} className="flex items-center gap-2 text-sm">
              <span className="h-3 w-3 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="text-slate-600 dark:text-slate-300">{d.name}</span>
              <span className="text-slate-400">({Math.round((d.value / total) * 100)}%)</span>
            </div>
          ))}
          {data.length === 0 && <p className="text-sm text-slate-400">veri yok</p>}
        </div>
      </div>
    </div>
  );
}
