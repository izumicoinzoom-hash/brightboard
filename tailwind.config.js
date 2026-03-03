/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    'bg-cyan-300',
    'bg-yellow-400',
    'bg-gray-100',
    'bg-red-100',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
