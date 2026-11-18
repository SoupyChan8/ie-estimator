import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://soupychan8.github.io/ie-estimator/
export default defineConfig({
  base: "/ie-estimator/",
  plugins: [react()],
});
