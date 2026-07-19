# PhantomPlay Native-Live Runtime

PhantomPlay now has a packaged desktop shell foundation without giving up live server updates.

## Product direction

- PhantomForce can ship as a real desktop app.
- The desktop app loads the live PhantomForce admin surface by default.
- Game catalog, pricing, copy, balance tuning, art references, and approved browser builds remain server-editable.
- Users do not need to redownload the desktop app for normal PhantomPlay content changes.
- The app still has a local fallback so the shell can open the bundled app if the live surface is unavailable.

## Runtime boundary

The first lane remains browser-first:

- HTML5
- JavaScript
- WebAssembly
- WebGL
- Godot web exports
- approved PhantomPlay native modules

The packaged shell does not allow arbitrary executable games. Windows executables, native installers, browser extensions, and unsigned native bundles stay blocked unless a future signed native-module pipeline explicitly approves them.

## Desktop shell

The Electron shell lives in:

```text
packages/phantomforce-desktop
```

It provides a narrow `window.phantomDesktop` bridge with:

- runtime policy
- local notification hook
- approved external-open hook

Web content runs with:

- context isolation on
- node integration off
- sandbox on
- origin allowlist

## Engine contract

Shared engine policy lives in:

```text
app/phantomplay-engine-policy.json
```

The frontend and server publish the same `3.0-native-live` intent:

- larger save states
- chunked large-map support
- local game cache support
- signed manifest update expectation
- server-editable catalog
- no redownload for content updates

