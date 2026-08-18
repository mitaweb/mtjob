import { useEffect, useState } from 'react';
import { chotGio, dangGo } from '../lib/gio';

// Ô nhập giờ 24h. Thay <input type="time"> vì ô đó hiện AM/PM (SA/CH) theo cài đặt máy
// người dùng và trang web không ép được. Xem ghi chú đầu lib/gio.ts.

interface Props {
  value: string; // 'HH:mm'
  onChange: (v: string) => void;
  className?: string;
  disabled?: boolean;
}

export default function TimeInput({ value, onChange, className = '', disabled }: Props) {
  // Giữ chuỗi đang gõ riêng: chốt ngay từng phím thì gõ "1" thành "01:00" rồi không gõ
  // tiếp được số thứ hai.
  const [nhap, setNhap] = useState(value);
  useEffect(() => setNhap(value), [value]);

  function xong() {
    const gio = chotGio(nhap);
    setNhap(gio);
    if (gio !== value) onChange(gio);
  }

  return (
    <input
      className={`input ${className}`}
      // Điện thoại bật thẳng bàn phím số; máy tính vẫn gõ bình thường.
      inputMode="numeric"
      placeholder="HH:mm"
      maxLength={5}
      disabled={disabled}
      value={nhap}
      onChange={(e) => setNhap(dangGo(e.target.value))}
      onBlur={xong}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
