import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { vnd, currentYm } from '../lib/format';
import KyLuatThang, { type TongKetKyLuat } from '../components/KyLuatThang';
import type { PayrollLine } from '../lib/types';

export default function Payroll() {
  const init = currentYm();
  const [ym, setYm] = useState(`${init.year}-${String(init.month).padStart(2, '0')}`);
  const [line, setLine] = useState<PayrollLine | null>(null);
  const [kyLuat, setKyLuat] = useState<TongKetKyLuat | null>(null);
  const [canhBao, setCanhBao] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const [y, m] = ym.split('-');
    api<{ line: PayrollLine | null; kyLuat: TongKetKyLuat | null; canhBao: string }>(
      `/payroll/me?year=${y}&month=${m}`,
    )
      .then((r) => {
        setLine(r.line);
        setKyLuat(r.kyLuat);
        setCanhBao(r.canhBao || '');
        if (!r.line) setMsg('Chưa có dữ liệu lương cho kỳ này (hoặc bạn là giám đốc — không tính payroll).');
        else setMsg('');
      })
      .catch((e) => setMsg((e as Error).message));
  }, [ym]);

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Lương & Công</h1>
          <input type="month" className="input max-w-[10rem]" value={ym} onChange={(e) => setYm(e.target.value)} />
        </div>
      </div>

      <KyLuatThang kyLuat={kyLuat} canhBao={canhBao} />

      {line ? (
        <div className="card space-y-2">
          <Row label="Ngày công thực tế" value={`${line.actualDays} / ${line.standardDays} ngày`} />
          <Row label="Mức lương" value={vnd(line.grossSalary)} />
          <Row label="Trừ BHXH (10,5% mức đóng)" value={`- ${vnd(line.bhxh)}`} />
          <div className="border-t pt-2 flex justify-between text-lg font-bold">
            <span>Lương thực lãnh</span>
            <span className="text-emerald-700">{vnd(line.netSalary)}</span>
          </div>
          <p className="text-xs text-ink-faint">
            Công thức: Mức lương ÷ ngày công chuẩn × ngày làm thực tế − 10,5% × mức đóng BHXH.
          </p>
        </div>
      ) : (
        <div className="card text-sm text-ink-muted">{msg}</div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-ink-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
