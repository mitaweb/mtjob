/** @type {import('tailwindcss').Config} */
//
// Màu thương hiệu MT Digital — Ocean Blue (anh Tâm 4/8/2026, theo file Brand Guidelines).
// Trước đây app chạy tím #7367f0, không dính gì tới nhận diện của công ty.
//
// Mọi cặp chữ/nền dưới đây ĐÃ ĐO tương phản, không ước lượng bằng mắt:
//   chữ trắng trên brand-600 .... 6.61
//   chữ trắng trên brand-700 .... 8.37
//   chữ ink  trên nền app ....... 13.09
//   chữ muted trên nền app ...... 6.73
//   chữ ink  trên accent ........ 8.44
// Chuẩn AA cho chữ thường là 4.5.
//
// CẤM chữ trắng trên `accent`: chỉ đạt 1.70. Vàng luôn đi với chữ ink.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f3f7fc',
          100: '#e2ebf8',
          200: '#c4d7f1',
          300: '#99b8e6',
          400: '#5e90d8',
          500: '#2d6fcc',
          600: '#0b57c4', // Ocean Blue — màu chính
          700: '#0949a5',
          800: '#073b85',
          900: '#062d66',
        },
        /** Vàng nhấn: cảnh báo nhẹ, con số cần chú ý. Luôn dùng với chữ `ink`. */
        accent: {
          50: '#fff8e6',
          100: '#ffefc0',
          300: '#ffd766',
          500: '#ffbb03',
          700: '#c48f00',
        },
        /** Navy đậm cho chữ — ấm hơn xám trung tính, hợp nền ngả xanh. */
        ink: {
          DEFAULT: '#232650',
          soft: '#3a3c55',
          muted: '#52546d',
        },
      },
      backgroundColor: {
        /** Nền trang: xanh rất nhạt thay cho #f5f5f9 xám. */
        app: '#eff5ff',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
        brand: ['Montserrat', 'Arial', 'sans-serif'],
        'brand-serif': ['"Playfair Display"', 'Georgia', 'serif'],
      },
      borderRadius: {
        // Bo góc lớn hơn để giống ảnh mẫu anh Tâm gửi.
        xl: '0.9rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        // Bóng ngả xanh thay vì xám tím, dịu và "nổi" hơn bóng cũ.
        soft: '0 2px 10px 0 rgba(11, 87, 196, 0.07)',
        card: '0 6px 20px -4px rgba(11, 87, 196, 0.12)',
        lift: '0 12px 28px -8px rgba(11, 87, 196, 0.22)',
      },
    },
  },
  plugins: [],
};
