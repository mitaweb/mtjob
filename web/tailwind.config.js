/** @type {import('tailwindcss').Config} */
//
// Giao diện VÀNG CHỦ ĐẠO, kiểu Gen Z (anh Tâm 18/10/2026: "anh cũng muốn giao diện vàng chủ đạo lại, thiết kế lại
// giao diện cho hiện đại, phù hợp genz" — chọn bản xem thử: vàng Amber, viền đậm + bóng lệch kiểu sticker, thanh bên
// màu mực). Màu lấy từ Brand Guidelines MT DIGITAL: Amber Yellow #FFBB03, Ocean Blue #0B57C4,
// Slate Grey #52546D, Light Grey #F4F5F7.
//
// `brand` = VÀNG (nền, nút, mục đang chọn). `ocean` = XANH (chữ nhấn, link, viền focus). Chữ vàng trên nền trắng chỉ
// đạt 1.70 → CẤM dùng `text-brand-*` cho chữ thường; chữ nhấn dùng `text-ocean-*`.
//
// Tương phản đã ĐO (chuẩn AA chữ thường 4.5):
//   ink trên brand-600 (vàng) ....... 10.33   ink trên nền kem ......... 16.98
//   ink-muted trên nền kem .......... 7.13    ink-faint trên nền kem ... 4.78
//   ocean-600 trên trắng ............ 6.61    ocean-600 trên brand-100 . 5.83
//   brand-800 trên trắng ............ 6.45    chữ thanh bên trên ink ... 10.88
//   ink-muted trên brand-600 chỉ 4.34 → trên nền vàng đậm chỉ dùng chữ ink / ink-soft.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff9e6',
          100: '#fff0c2',
          200: '#ffe285',
          300: '#ffd447',
          400: '#ffc61f',
          500: '#ffbb03',
          600: '#ffbb03', // Amber Yellow — màu chính (nền nút, mục đang chọn) — đi với chữ ink
          700: '#e5a800', // hover
          800: '#7a5900', // vàng đất — chữ trên nền sáng khi thật cần sắc vàng
          900: '#4d3800',
        },
        /** Xanh Ocean Blue: chữ nhấn, link, số liệu cần nổi, viền focus. */
        ocean: {
          50: '#f3f7fc',
          100: '#e2ebf8',
          200: '#c4d7f1',
          300: '#99b8e6',
          400: '#5e90d8',
          500: '#2d6fcc',
          600: '#0b57c4',
          700: '#0949a5',
          800: '#073b85',
          900: '#062d66',
        },
        /** Vàng nhấn (giữ cho tương thích chỗ cũ) — luôn đi với chữ `ink`. */
        accent: {
          50: '#fff8e6',
          100: '#ffefc0',
          300: '#ffd766',
          500: '#ffbb03',
          700: '#c48f00',
        },
        ink: {
          DEFAULT: '#16172e', // mực — chữ chính, viền đậm, thanh bên
          soft: '#3a3c55',
          muted: '#52546d', // Slate Grey
          faint: '#6b6e8f',
        },
      },
      borderColor: {
        // Đường kẻ mảnh trong bảng: kem đậm, hợp nền vàng.
        DEFAULT: '#efe4c6',
      },
      backgroundColor: {
        /** Nền trang: kem ấm. */
        app: '#fffbf0',
      },
      fontFamily: {
        // Poppins trên Google Fonts THIẾU chữ tiếng Việt dấu chồng (U+1EA0–1EF1: ế, ữ, ộ…) → chữ bị lẫn font (anh Tâm
        // 18/10/2026: 'đang lỗi font'). Nội dung: Be Vietnam Pro (làm riêng cho tiếng Việt); tiêu đề / logo: Montserrat —
        // font thay thế Poppins mà Brand Guidelines cho phép. Cả hai có đủ bộ chữ tiếng Việt.
        sans: ['"Be Vietnam Pro"', 'system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
        brand: ['Montserrat', 'Arial', 'sans-serif'],
        'brand-serif': ['Montserrat', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        xl: '0.9rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        // Bóng lệch đặc (kiểu sticker) — dấu hiệu Gen Z của giao diện.
        pop: '3px 3px 0 0 #16172e',
        'pop-lg': '5px 5px 0 0 #16172e',
        soft: '0 2px 10px 0 rgba(22, 23, 46, 0.06)',
        card: '0 6px 20px -4px rgba(22, 23, 46, 0.12)',
        lift: '5px 5px 0 0 #16172e',
      },
    },
  },
  plugins: [],
};
