/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f3f1ff',
          100: '#e9e6ff',
          200: '#d6d0ff',
          300: '#b7acff',
          500: '#7367f0',
          600: '#5b4ee6',
          700: '#4a3fd0',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
        brand: ['Montserrat', 'Arial', 'sans-serif'],
        'brand-serif': ['"Playfair Display"', 'Georgia', 'serif'],
      },
      boxShadow: {
        soft: '0 2px 10px 0 rgba(47, 43, 61, 0.08)',
        card: '0 4px 18px 0 rgba(47, 43, 61, 0.10)',
      },
    },
  },
  plugins: [],
};
