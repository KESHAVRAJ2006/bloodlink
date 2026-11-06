/** @type {import("tailwindcss").Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Deep red theme. "blood" is the brand colour, "ink" is the text grey.
        blood: {
          50: "#fdf2f3",
          100: "#fbe3e5",
          200: "#f5c3c7",
          300: "#ea9199",
          400: "#dc5a66",
          500: "#c62f3d",
          600: "#a81f2c",
          700: "#8a1a25",
          800: "#6b1620",
          900: "#4a0f16",
        },
        ink: {
          500: "#6b7280",
          700: "#374151",
          900: "#111827",
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(17, 24, 39, 0.04), 0 8px 24px rgba(17, 24, 39, 0.06)",
      },
    },
  },
  plugins: [],
};
