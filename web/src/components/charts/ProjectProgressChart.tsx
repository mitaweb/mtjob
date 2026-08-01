import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// Xem ghi chú ở PointsBarChart: tách riêng để lazy-load recharts.

export interface ProgressPoint {
  name: string;
  percent: number;
}

export default function ProjectProgressChart({ data }: { data: ProgressPoint[] }) {
  return (
    <div style={{ width: '100%', height: Math.max(160, data.length * 44) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
          <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v: number) => `${v}%`} />
          <Bar dataKey="percent" fill="#7367f0" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
