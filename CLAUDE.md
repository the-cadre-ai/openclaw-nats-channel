# CLAUDE.md

Guidance for Claude when working in this repository.

## What this is

An OpenClaw channel plugin (TypeScript, ESM) that bridges NATS subjects to the
OpenClaw chat model. Inbound NATS messages → prompts; LLM responses → outbound
NATS messages. See `README.md` for the user-facing overview and SDK docs at
https://docs.openclaw.ai/plugins/sdk-channel-plugins for the plugin contract.

Version: `0.0.1-beta`. Not yet validated against a live OpenClaw runtime.

## Architecture

Five-stage pipeline, one module per stage:

| Stage        | File                 | Responsibility                                      |
| ------------ | -------------------- | --------------------------------------------------- |
| Listen       | `src/nats-client.ts` | NATS connect, queue-group subscribe, publish, drain |
| Pre-process  | `src/inbound.ts`     | Decode envelope, verify HMAC, freshness, allowlist  |
| LLM          | (OpenClaw core)      | Plugin owns no LLM logic                            |
| Post-process | `src/outbound.ts`    | Resolve outbound subject, build signed envelope     |
| Publish      | `src/nats-client.ts` | Publish + flush                                     |

Wiring lives in `src/channel.ts` (`createChatChannelPlugin`). Entry points are
`index.ts` (`defineChannelPluginEntry`) and `setup-entry.ts`
(`defineSetupPluginEntry`).

Config schema is in `src/config.ts` (zod) and mirrored in `openclaw.plugin.json`
(JSON Schema, used by OpenClaw at install time).

## Key invariants — don't break these

- **Constant-time signature compare.** `envelope.verify` uses `timingSafeEqual`
  after a length check. Never replace with `===`.
- **Canonical JSON before signing.** `envelope.canonicalize` sorts object keys
  recursively. Producers in other languages rely on this — don't change ordering
  or whitespace without bumping the envelope version.
- **Security flags are coupled.** `parseConfig` forces `requireSignature` to
  `false` when no `hmacSecret` is configured. The two flags must stay
  consistent: code reading `requireSignature` may assume `hmacSecret` is set.
- **`buildSigned` only signs when `secret` is provided.** Don't change to
  default-sign — the unsigned path is intentional.
- **Subscription loop swallows per-message errors.** This keeps the subscription
  alive across malformed inbound. Log, don't throw.
- **`outbound.sendText` prefers `msg.reply` over the template.** This preserves
  NATS request/reply semantics when the producer uses it.

## SDK wiring (openclaw 2026.5.x)

Pinned to `openclaw@^2026.5.12`. The plugin literal in `src/channel.ts` is
built with the real public helpers from `openclaw/plugin-sdk/channel-core`:

- `createChatChannelPlugin<TResolvedAccount>({ base, security, outbound, ... })`
  — composes the `ChannelPlugin` object with `ChatChannelSecurityOptions`
  (`security.dm`) and `ChatChannelAttachedOutboundOptions`
  (`outbound.{base,attachedResults}`).
- `defineChannelPluginEntry({ id, name, description, plugin })` in `index.ts`
  — produces the `{ register(api) }` shape the openclaw loader consumes.
- `defineSetupPluginEntry(plugin)` in `setup-entry.ts`.

Key conventions in our wiring:

- **Account resolution**: `config.resolveAccount(cfg, accountId)` reads from
  `cfg.channels.nats` (single-account) or `cfg.channels.nats.accounts[id]`
  (multi-account), then runs through our zod schema. A "default" account id
  is synthesized for single-account configs.
- **Long-lived NATS connection**: opened in `gateway.startAccount`, kept in
  the module-level `liveClients` map, drained in `gateway.stopAccount` and on
  `ctx.abortSignal`.
- **Inbound dispatch**: `gateway.startAccount` subscribes; each message goes
  through `preProcess`, then is handed to
  `ctx.channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher(...)`.
  The `deliver` callback publishes the LLM response back to NATS via
  `outbound.sendText`.
- **Outbound sends**: `outbound.attachedResults.sendText` looks up the live
  client by `accountId` and publishes a signed envelope. Returns
  `{ messageId }` to satisfy `OutboundDeliveryResult`.
- **channelRuntime** is intentionally loosely typed in the SDK for external
  plugins; we cast through `unknown` at the single call site rather than
  pretending we have full type coverage.

Reference real plugin types under
`node_modules/openclaw/dist/plugin-sdk/src/channels/plugins/*.d.ts`, especially
`types.plugin.d.ts`, `types.adapters.d.ts`, `types.core.d.ts`, and
`outbound.types.d.ts`. The public helper signatures are in
`node_modules/openclaw/dist/plugin-sdk/src/plugin-sdk/core.d.ts`.

## Commands

```bash
npm install           # install deps
npm run typecheck     # tsc --noEmit
npm test              # vitest run (all 23 tests should pass)
npm run build         # tsc → dist/
```

## Testing conventions

- All tests live in `src/channel.test.ts` (single file, fast).
- Use `parseConfig` to build test configs — never construct `NatsChannelConfig`
  literals, since the transform on `security` is load-bearing.
- When adding a new pre-process rejection reason: extend the `RejectReason`
  union, add a branch in `preProcess`, and add a test that asserts on
  `decision.reason`.
- When changing envelope format: add a canonicalization test (key order
  independence) and a tamper test. Bump the version in `package.json` and
  `README.md`.

## Things to avoid

- Don't add a logger dependency; the SDK host provides `host.log`. Inside
  modules with no host (the subscription loop's fallback path), `console.error`
  is acceptable.
- Don't add JetStream, key-value, or object-store features in v0.x — scope is
  core pub/sub + queue groups only.
- Don't add media/poll send capabilities. `outbound.attachedResults.sendText` is
  the only declared capability for v1.
- Don't widen the `@nats-io/transport-node` surface beyond what
  `src/nats-client.ts` exposes. Keep the NATS dependency contained in that one
  file so future transport swaps (browser, Deno, ws) stay cheap.

## Known follow-ups

- No live integration test yet against a running nats-server + OpenClaw
  instance. The `channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher`
  call's `ctx` shape is loosely typed in the SDK and may need field tweaks
  once exercised end-to-end (sender/route fields are the most likely culprits).
- `defaultAccountId` always returns `"default"`. Multi-account deployments
  should override this to read `cfg.channels.nats.defaultAccount` or similar.
