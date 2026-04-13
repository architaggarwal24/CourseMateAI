/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#0A0A0A",
          secondary: "#050505",
          card: "#0d0d0d",
          hover: "#151515",
        },
        border: {
          subtle: "#1f1f1f",
          DEFAULT: "#2a2a2a",
          accent: "#3a3a3a",
        },
        text: {
          primary: "#EDEDED",
          secondary: "#E0E0E0",
          muted: "#888888",
        },
        accent: {
          gold: "#ffaa00",
          green: "#28a745",
          red: "#dc3545",
          blue: "#667eea",
          purple: "#764ba2",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      typography: {
        DEFAULT: {
          css: {
            color: '#E0E0E0',
            maxWidth: 'none',
            h1: { color: '#EDEDED' },
            h2: { color: '#EDEDED' },
            h3: { color: '#E0E0E0' },
            h4: { color: '#E0E0E0' },
            strong: { color: '#EDEDED' },
            code: { color: '#667eea' },
            a: { color: '#667eea' },
            blockquote: { color: '#888888' },
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};