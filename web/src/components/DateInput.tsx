// Ô chọn ngày CÓ THỂ BỎ TRỐNG.
//
// Anh Tâm 21/8/2026: "lỡ bấm vào chọn anh không xoá được nếu chưa có thông tin đó".
// Ô <input type="date"> của trình duyệt không có nút xoá đáng tin — Chrome chỉ hiện dấu
// ✕ ở vài phiên bản, còn trên điện thoại thì gần như không có đường nào để trả về trống.
// Với mấy trường không bắt buộc (ngày sinh, ngày chốt hợp đồng) thì lỡ tay là dính luôn
// một ngày sai, mà ngày sai còn tệ hơn để trống.

interface Props {
  value: string; // 'YYYY-MM-DD' hoặc ''
  onChange: (v: string) => void;
  id?: string;
  max?: string;
  className?: string;
}

export default function DateInput({ value, onChange, id, max, className = '' }: Props) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        className={`input ${className}`}
        type="date"
        max={max}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {/* Chỉ hiện khi CÓ ngày — không có gì để xoá thì nút chỉ tổ rối mắt. */}
      {!!value && (
        <button
          type="button"
          className="shrink-0 rounded-lg px-2 py-1 text-xs text-rose-600 underline hover:bg-rose-50"
          onClick={() => onChange('')}
        >
          xoá
        </button>
      )}
    </div>
  );
}
