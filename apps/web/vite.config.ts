import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendTarget = process.env.VITE_BACKEND_PROXY_TARGET ?? "http://127.0.0.1:5190";

const backendProxy = {
  "/auth": backendTarget,
  "/billing": backendTarget,
  "/client-access": backendTarget,
  "/client-access-approvals": backendTarget,
  "/client-provisioning": backendTarget,
  "/client-workspaces": backendTarget,
  "/pangolin": backendTarget,
  "/phantom-ai": backendTarget,
  "/readiness": backendTarget,
  "/session": backendTarget,
  "/sessions": backendTarget,
};

function phantomAppIndexPlugin() {
  return {
    name: "phantom-app-index",
    configureServer(server: { middlewares: { use: (middleware: typeof rewritePhantomAppIndex) => void } }) {
      server.middlewares.use(rewritePhantomAppIndex);
    },
    configurePreviewServer(server: { middlewares: { use: (middleware: typeof rewritePhantomAppIndex) => void } }) {
      server.middlewares.use(rewritePhantomAppIndex);
    },
  };
}

function rewritePhantomAppIndex(
  req: { url?: string; headers?: { host?: string | string[] } },
  _res: unknown,
  next: () => void,
) {
  const originalUrl = req.url ?? "";
  const queryIndex = originalUrl.indexOf("?");
  const path = queryIndex === -1 ? originalUrl : originalUrl.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : originalUrl.slice(queryIndex);
  const hostHeader = req.headers?.host;
  const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader ?? "").split(":")[0];
  const phantomHosts = new Set(["admin.phantomforce.online", "app.phantomforce.online"]);

  if (path === "/app" || path === "/app/" || (path === "/" && phantomHosts.has(host))) {
    req.url = `/app/index.html${query}`;
  }

  next();
}

export default defineConfig({
  plugins: [phantomAppIndexPlugin(), react()],
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true,
    allowedHosts: [
      "admin.phantomforce.online",
      "app.phantomforce.online",
    ],
    proxy: backendProxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true,
    allowedHosts: [
      "admin.phantomforce.online",
      "app.phantomforce.online",
    ],
    proxy: backendProxy,
  },
});
