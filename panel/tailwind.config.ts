import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          dark: "rgb(var(--brand-dark) / <alpha-value>)",
        },
        cyan: { accent: "rgb(var(--accent-cyan) / <alpha-value>)" },
        violet: { accent: "rgb(var(--accent-violet) / <alpha-value>)" },
        good: "rgb(var(--good) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        crit: "rgb(var(--crit) / <alpha-value>)",
      },
      boxShadow: {
        glow: "0 0 18px rgb(var(--brand) / 0.5)",
      },
    },
  },
  plugins: [],
};

export default config;
