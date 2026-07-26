# PhantomBot 0.4 authenticated operator event streaming

Date: 2026-07-26

## Outcome

PhantomBot now prefers a native authenticated WebSocket for Hermes operator progress. The existing authenticated HTTP polling loop remains available and is used automatically after three failed stream connections.

Endpoint:

`/ws/phantom-ai/hermes-acp/sessions/:id`

Protocol:

`phantomforce.hermes-operator.v1`

## Authentication and binding

The browser does not put its bearer token in the WebSocket URL. Immediately after the socket opens it sends one bounded authentication frame containing:

- bearer session token
- requested operator session ID from the URL
- exact workspace label
- last accepted normalized event cursor

The server resolves the signed in-memory, database, or local-customer session. It then reloads the operator session through the same actor/organization authorization used by HTTP. No event is sent before authentication, session ownership, and workspace binding pass.

Invalid tokens, cross-workspace sessions, wrong workspace labels, oversized client frames, and missing authentication fail closed with WebSocket policy or size close codes.

## Authoritative events

The stream subscribes to two server-owned event sources:

- durable Hermes operator-session journal writes
- durable shared agent-run journal writes

Agent-run changes are reconciled into normalized operator events before transmission. Raw Hermes JSON-RPC events, assistant machine-intent markup, server artifact paths, and run input payloads are not streamed.

Each normalized operator event retains its persisted integer `sequence`. The client merges by sequence and suppresses duplicates.

## Recovery and flow control

- reconnect cursor requests only missed events
- a cursor ahead of authoritative state is rejected and recovered with a full bounded replay
- session journals survive service restart
- a reconnect at the terminal cursor receives terminal state with zero repeated events
- heartbeat frame every 15 seconds
- client heartbeat timeout after 35 seconds
- three bounded reconnect attempts before polling fallback
- coalesced server updates
- 16 KiB client-frame limit
- 800 KiB server-frame limit
- 1 MB buffered-output backpressure close
- stream cancellation uses the same operator and agent-run cancellation paths as HTTP

## Client behavior

The create-session response advertises both transports:

- primary: authenticated WebSocket
- fallback: authenticated polling endpoint

The desktop reconnects with its last cursor, merges missed normalized events, persists state locally, and stops watching when approval is required or a terminal state arrives. Approval continuation starts a fresh stream from the existing cursor.

## Verification

`npm run test:hermes-operator-stream --workspace @phantomforce/server` proves:

- valid authenticated connection
- invalid-token rejection
- cross-workspace rejection
- workspace-label binding
- forged cursor recovery
- disconnect and missed-event recovery
- duplicate suppression
- repeated terminal suppression
- cancellation
- raw assistant-text suppression
- approved run-input suppression

The broader `npm run test:phantombot-operator` command includes this stream suite, ACP transport normalization, operator persistence/reopen, and governed engineering operations.

Secret-shaped write content is rejected during plan parsing, before the plan can reach either the approval UI or stream.
