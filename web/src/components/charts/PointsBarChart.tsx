import { MAU } from './mau';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// Biểu đồ tách thành tệp riêng để LAZY-LOAD được.
//
// recharts nặng 360KB — gần gấp đôi toàn bộ phần còn lại của app. Để chung trong trang
// thì mở Tổng quan là phải tải hết mới thấy được bảng xếp hạng, dù bảng mới là thứ cần
// nhìn trước. Tách ra thì bảng hiện ngay, biểu đồ điền vào sau một nhịp.

export interface PointsPoint {
  name: string;
  points: number;
}

export default function PointsBarChart({ data }: { data: PointsPoint[] }) {
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data}>
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="points" fill={MAU.chinh} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
