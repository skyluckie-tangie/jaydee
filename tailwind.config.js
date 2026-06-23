/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // DAW dark theme colors inspired by Cubase / modern DAWs
        bg: '#0f0f12',
        'bg-panel': '#18181b',
        'bg-elevated': '#27272a',
        border: '#3f3f46',
        accent: '#a78bfa',
        'accent-hover': '#c4b5fd',
        text: '#e4e4e7',
        'text-muted': '#a1a1aa',
      }
    },
  },
  plugins: [],
}
