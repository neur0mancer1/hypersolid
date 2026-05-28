/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        ink: "#0a0a0b",
        panel: "#141417",
        panel2: "#1b1b1f",
        edge: "#2a2a30",
        accent: "#ff7a18",
        accent2: "#ffa24b",
        good: "#3ddc97",
        bad: "#ff5d5d",
        warn: "#ffcf5c",
        muted: "#7a7a85",
      },
    },
  },
  plugins: [],
};
