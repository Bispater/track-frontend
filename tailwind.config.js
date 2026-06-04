/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        // Variables CSS para que dark/light se respete
        bg: 'var(--bg)',
        'bg-elev': 'var(--bg-elev)',
        'bg-soft': 'var(--bg-soft)',
        border: 'var(--border)',
        text: 'var(--text)',
        'text-dim': 'var(--text-dim)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        err: 'var(--err)',
      },
      borderRadius: { DEFAULT: '4px' },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Ubuntu', 'sans-serif'],
        mono: ['ui-monospace', '"JetBrains Mono"', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
