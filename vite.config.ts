import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, watch: { ignored: ["**/research/**", "**/.local/**"] } },
  preview: { port: 4173, strictPort: true },
  build: { chunkSizeWarningLimit: 1600 },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
