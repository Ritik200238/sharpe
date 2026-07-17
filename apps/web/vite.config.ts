import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH lets a GitHub Pages project deploy (served from /<repo>/) use the
// right asset paths, while local dev and Vercel (served from /) stay at "/".
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 5173 },
  build: { target: "es2022", sourcemap: false },
});
