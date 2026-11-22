const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: { bg: c("bg"), surface: c("surface"), line: c("line"), ink: c("ink"), muted: c("muted"),
                accent: c("accent"), ok: c("ok"), bad: c("bad"), warn: c("warn") },
      fontFamily: { sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"] },
      borderRadius: { DEFAULT: "6px" },
    },
  },
};
