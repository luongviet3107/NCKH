/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe7ff',
          200: '#bfd3ff',
          300: '#93b4ff',
          400: '#608cff',
          500: '#3b66ff',
          600: '#2446f5',
          700: '#1d34e1',
          800: '#1e2db6',
          900: '#1e2c8f',
          950: '#171d57',
        },
      },
      boxShadow: {
        soft: '0 18px 50px -28px rgba(15, 23, 42, 0.28)',
        glow: '0 0 0 1px rgba(59, 102, 255, 0.08), 0 22px 54px -30px rgba(36, 70, 245, 0.55)',
      },
      backgroundImage: {
        'grid-light': 'linear-gradient(to right, rgba(148,163,184,.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,.09) 1px, transparent 1px)',
        'grid-dark': 'linear-gradient(to right, rgba(148,163,184,.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,.07) 1px, transparent 1px)',
      },
      animation: {
        'fade-up': 'fadeUp .45s ease-out both',
        'fade-in': 'fadeIn .3s ease-out both',
        shimmer: 'shimmer 1.8s linear infinite',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '.55' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
