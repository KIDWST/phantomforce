# Performance Report

Production renderer build:

- 4,511 modules transformed.
- CSS bundle: 341.68 kB (57.31 kB gzip).
- Main renderer bundle: 28.51 MB (6.18 MB gzip); Vite reports the existing large-chunk warning.
- Electron main bundle: 647.4 kB.
- Electron preload bundle: 17.4 kB.

Runtime observations:

- Composer presence uses one state-selected WebP plus CSS glow/wisps; it performs no canvas loop and accepts reduced motion.
- Exact model reselection is now a no-op before the gateway call, avoiding needless runtime construction.
- The live user's explicit 262,144-token Ollama context override was preserved. It loaded a 26 GB runtime footprint and makes first-token latency materially longer than the normalized 65,536-token product default.

Follow-up performance work should split the large renderer chunk and expose a clearer UI affordance for expensive explicit context overrides; neither is disguised as a functional failure.
