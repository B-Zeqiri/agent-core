export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'brand': {
          dark: '#0b0e14',
          panel: '#11151c',
          border: '#1a1f2b',
          text: '#e6e8eb',
          muted: '#9aa1ae',
          accent: '#4da3ff',
          success: '#32d074',
          error: '#ff5d5d',
        }
      }
    },
  },
  plugins: [],
}

