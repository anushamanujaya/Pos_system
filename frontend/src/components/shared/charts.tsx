import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { money } from '@/lib/format';

/** Categorical colours in fixed order (validated: lightness band, chroma, CVD separation, contrast on white). */
export const SERIES = ['#0b9a8c', '#6d5bd0', '#c2410c', '#2563eb'] as const;
const AXIS = { fontSize: 11, fill: '#5b6472' };
const rupees = (c: number) =>
  Math.abs(c) >= 100_000_00
    ? `${(c / 100_000_00).toFixed(1)}M`
    : Math.abs(c) >= 100_000
      ? `${Math.round(c / 100_000)}k`
      : String(Math.round(c / 100));

function Tip({
  active,
  payload,
  label,
  fmt,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  fmt: (n: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 tabular">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <strong>{fmt(p.value)}</strong>
        </p>
      ))}
    </div>
  );
}

export function ChartBox({
  title,
  children,
  empty,
}: {
  title: string;
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="h-64" role="img" aria-label={title}>
        {empty ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            No data for this period
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/** Money line chart; ≥2 series get a legend. All series share one axis (never dual-axis). */
export function MoneyLines({
  data,
  xKey,
  series,
}: {
  data: Record<string, string | number>[];
  xKey: string;
  series: { key: string; name: string }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e5e7eb" vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={rupees} width={44} />
        <Tooltip content={<Tip fmt={money} />} />
        {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={SERIES[i]}
            strokeWidth={2}
            dot={data.length < 14 ? { r: 3, strokeWidth: 2, stroke: '#fff' } : false}
            activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MoneyBars({
  data,
  xKey,
  yKey,
  name,
  horizontal,
}: {
  data: Record<string, string | number>[];
  xKey: string;
  yKey: string;
  name: string;
  horizontal?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 8, left: horizontal ? 24 : 0, bottom: 0 }}
      >
        <CartesianGrid stroke="#e5e7eb" horizontal={!horizontal} vertical={!!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={AXIS} tickFormatter={rupees} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey={xKey} tick={AXIS} width={110} tickLine={false} axisLine={false} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
            <YAxis tick={AXIS} tickFormatter={rupees} tickLine={false} axisLine={false} width={44} />
          </>
        )}
        <Tooltip content={<Tip fmt={money} />} cursor={{ fill: '#f3f4f6' }} />
        <Bar
          dataKey={yKey}
          name={name}
          fill={SERIES[0]}
          radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          maxBarSize={28}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="flex h-full items-center gap-4">
      <ResponsiveContainer width="50%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="60%"
            outerRadius="90%"
            stroke="#fff"
            strokeWidth={2}
            paddingAngle={0}
          >
            {data.map((d, i) => (
              <Cell key={d.name} fill={SERIES[i % SERIES.length]} />
            ))}
          </Pie>
          <Tooltip content={<Tip fmt={money} />} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="flex-1 space-y-2 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
              {d.name}
            </span>
            <span className="tabular text-muted-foreground">
              {total ? Math.round((d.value / total) * 100) : 0}% · {money(d.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
