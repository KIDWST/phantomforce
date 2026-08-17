# PhantomPlay Native Runtime

This package is the native Panda3D lane for PhantomPlay. It currently owns one playable vertical
slice:

- **Phantom Strike**: the experimental native FPS lane. The HTML build remains the primary
  playable build inside PhantomPlay Studio.

The existing HTML games remain the portable web builds. The Dioxus desktop studio launches this
runtime only for native-capable projects. Vespergate remains a web/Canvas game.

## Setup

```powershell
powershell -ExecutionPolicy Bypass -File .\Install-NativeRuntime.ps1
```

## Run

```powershell
.\.venv\Scripts\python.exe -m phantomplay_native --game phantom-strike
```

Phantom Strike uses `WASD` movement, mouse aim, click to fire, and `Escape` to pause.
