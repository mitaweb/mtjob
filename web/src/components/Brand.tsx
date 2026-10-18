// Logo MT DIGITAL theo Brand Guidelines: logotype "MT DIGITAL" Poppins Bold chữ hoa, trắng, đặt trong khối bo góc
// màu Ocean Blue, dòng slogan màu vàng Amber bên dưới. Khối xanh đọc rõ trên mọi nền (sáng, thanh bên mực, nền vàng).
// `variant` giữ cho tương thích chỗ gọi cũ — logo dạng khối không cần đổi màu theo nền.
interface BrandProps {
  variant?: 'light' | 'dark';
  compact?: boolean; // header / thanh bên: khối nhỏ, slogan ngắn
  className?: string;
}

export default function Brand({ compact = false, className = '' }: BrandProps) {
  return (
    <div
      className={`inline-flex select-none flex-col items-center rounded-xl bg-ocean-600 text-center leading-none ${
        compact ? 'px-3 py-1.5' : 'px-6 py-3'
      } ${className}`}
    >
      <span className={`font-bold uppercase tracking-wide text-white ${compact ? 'text-base' : 'text-3xl'}`}>MT DIGITAL</span>
      <span className={`mt-1 font-semibold uppercase text-brand-500 ${compact ? 'text-[7px] tracking-[0.18em]' : 'text-[10px] tracking-[0.22em]'}`}>
        {compact ? 'Marketing trọn gói' : 'Marketing trọn gói cho doanh nghiệp'}
      </span>
    </div>
  );
}
