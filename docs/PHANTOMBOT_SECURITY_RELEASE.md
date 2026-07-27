# PhantomBot security release gate

PhantomBot packaging fails when the production dependency tree contains a
critical npm advisory. The release command also runs the PhantomBot doctor,
which blocks unpublished product commits, missing Hermes kernel installations,
invalid desktop identity, and unpinned Hermes bootstrap commits.

As of 2026-07-26, `npm audit --omit=dev` reports no critical findings and one
high-severity advisory represented by two dependency rows:

- `react-router` and its direct consumer `react-router-dom`
- [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2):
  an RSC server-action CSRF issue

The advisory is not reachable in the PhantomBot desktop architecture.
PhantomBot uses React Router's client-only `HashRouter` in an Electron
renderer. It does not run React Server Components, a React Router framework
server, server actions, or an HTTP action endpoint. The affected request path
therefore does not exist in the application.

npm currently proposes `react-router-dom@7.11.0`, an incompatible downgrade,
rather than a patched 7.x version. Keep this exception under review and remove
it when a compatible patched release is available. A future change that adds
React Router server actions, RSC mode, or an HTTP framework server invalidates
this exception and must block release until the advisory is fixed.

This exception does not waive critical advisories. `npm run phantombot:audit`
is the automated critical-severity gate used by `npm run phantombot:package`.
