import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5188,
    allowedHosts: ["app.phantomforce.online"],
    proxy: {
      "/auth": "http://127.0.0.1:5190",
      "/billing": "http://127.0.0.1:5190",
      "/client-access": "http://127.0.0.1:5190",
      "/client-access-approvals": "http://127.0.0.1:5190",
      "/client-provisioning": "http://127.0.0.1:5190",
      "/client-workspaces": "http://127.0.0.1:5190",
      "/pangolin": "http://127.0.0.1:5190",
      "/phantom-ai": "http://127.0.0.1:5190",
      "/readiness": "http://127.0.0.1:5190",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4188,
  },
});
