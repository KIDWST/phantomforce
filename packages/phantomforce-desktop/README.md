# PhantomForce Desktop

Packaged desktop shell for PhantomForce + PhantomPlay.

The shell is intentionally live/server-based: it loads the current PhantomForce app URL by default, so UI, game catalog, pricing, policy, and content can update without making users redownload the desktop app.

What becomes native:

- controlled Chromium/Electron host;
- PhantomPlay native-live runtime bridge;
- local game cache policy;
- larger approved game bundle limits;
- controller/keyboard/fullscreen capability reporting;
- OS notifications for background-job completion;
- origin allow-listing for the live app and local dev server.

What stays server-editable:

- app UI;
- PhantomPlay catalog;
- game policy manifest;
- pricing/entitlements;
- creator/product listings;
- game updates delivered as approved browser/WebAssembly/WebGL/Godot-web builds.

Run locally after installing workspace deps:

```bash
npm run dev --workspace @phantomforce/desktop
```

Override the live app URL:

```bash
PHANTOMFORCE_DESKTOP_URL=http://127.0.0.1:4321/app/ npm run start --workspace @phantomforce/desktop
```
