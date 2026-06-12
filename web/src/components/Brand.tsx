// Logo chữ MT DIGITAL (theo bộ nhận diện: sans đậm + tagline serif nghiêng).
// variant light = chữ trắng (nền đậm), dark = chữ đen (nền sáng).
interface BrandProps {
  variant?: 'light' | 'dark';
  compact?: boolean; // chỉ hiện MT DIGITAL, ẩn tagline (cho header)
  className?: string;
}

export default function Brand({ variant = 'dark', compact = false, className = '' }: BrandProps) {
  const main = variant === 'light' ? 'text-white' : 'text-slate-900';
  const sub = variant === 'light' ? 'text-white/80' : 'text-slate-600';
  return (
    <div className={`select-none leading-none text-center ${className}`}>
      <div
        className={`font-brand font-extrabold tracking-[0.12em] ${compact ? 'text-lg' : 'text-3xl'} ${main}`}
      >
        MT DIGITAL
      </div>
      {!compact && (
        <div className={`font-brand-serif italic mt-1.5 text-sm ${sub}`}>
          Marketing trọn gói cho doanh nghiệp
        </div>
      )}
    </div>
  );
}
