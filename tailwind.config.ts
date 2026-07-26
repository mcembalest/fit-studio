import type { Config } from "tailwindcss";

// Deliberately thin. Colours and spacing come from CSS custom properties in
// src/index.css so the whole look can be redesigned there without touching
// component markup.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "hsl(var(--canvas))",
        surface: "hsl(var(--surface))",
        line: "hsl(var(--line))",
        ink: "hsl(var(--ink))",
        muted: "hsl(var(--muted))",
        accent: "hsl(var(--accent))",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
