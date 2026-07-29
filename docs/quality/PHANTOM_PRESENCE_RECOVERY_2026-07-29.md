# Phantom Presence Recovery

Date: 2026-07-29

## Recovered Work

The animated Phantom was not deleted. The active deployment still contained:

- 11 painted character poses: assert, chin, conjure, coy, cross, laugh, point,
  present, scheme, sheepish, and welcome.
- 12 light/dark mode poses for ask, write, image, video, website, and admin.
- `app/js/character.js`, the live face, blink, eye-tracking, mood, pose-transition,
  and emotional-momentum engine.
- `app/js/phantom-3d.js`, the optional full stage renderer.
- The public-site cinematic treatment in `void.css` and `void.js`.

Relevant history includes:

- `36f2b677` - six painted body-language poses.
- `7fa72239` - emotional momentum and five additional stances.
- `04996e32` - root Phantom 3D stage.
- `bf9257a2` - restored companion and character.
- `1fbbc3f8` - movable, summonable Phantom chat.
- `cbefe6c0` - compact PhantomPet widget.

## Root Cause

Later Command OS presentation rules hid the large legacy character layers, while
the Overview pet and PhantomBot empty state used static brand images. The art and
animation engine remained available but were no longer mounted on the primary
admin surfaces.

## Restored Surfaces

- Overview: a compact live PhantomPet driven by the original character engine.
- PhantomBot: a large live painted Phantom in the new-task state.
- Both surfaces react to the existing listening, thinking, responding, success,
  warning, error, loop, and idle states.
- Reduced-motion preferences retain the character but stop continuous motion.

## Verification

- `npm run test:phantom-presence`
- `node --check app/js/phantom-presence.js`
- `node --check app/js/companion.js`
- `node --check app/js/phantomai.js`
- `node --check app/js/main.js`
- Desktop QA at 1440x900.
- Phone QA at 390x844.

The broad `test:command-surface` suite currently stops on an unrelated existing
assertion that expects a hard-coded Content Hub button in the global command
rail. The Phantom recovery test and the responsive media test pass.
