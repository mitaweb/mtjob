/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          500: '#2b6fe0',
          600: '#1f57c0',
          700: '#1b46a0',
        },
      },
    },
  },
  plugins: [],
};
