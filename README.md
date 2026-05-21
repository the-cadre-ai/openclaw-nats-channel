# openclaw-nats-channel

**Version 0.01 (beta)**

An [OpenClaw](https://docs.openclaw.ai) channel plugin that bridges
[NATS](https://nats.io) subjects to the OpenClaw chat model. Inbound NATS
messages are treated as prompts; LLM responses are published back to NATS on a
derived subject.

> Beta — APIs, config shape, and envelope format may change before 1.0. Not yet
> recommended for production traffic.

## Flow

1. **Listen** — subscribe to a configured subject (wildcards supported) on a
   configured queue group.
2. **Pre-process** — decode JSON envelope, verify HMAC signature (if a secret is
   configured), check timestamp freshness, enforce sender allowlist.
3. **LLM** — hand the prompt to OpenClaw core, which routes it to the chat
   model.
4. **Post-process** — wrap the response in a signed JSON envelope with
   correlation metadata.
5. **Publish** — send to a derived outbound subject (`msg.reply` takes
   precedence when set).

## Configuration

```jsonc
{
  "servers": "nats://localhost:4222",
  "token": "your-nats-token",
  "inbound": {
    "subject": "openclaw.prompt.>",
    "queueGroup": "claw-workers",
  },
  "outbound": {
    "subjectTemplate": "openclaw.response.{tail}",
  },
  "security": {
    "hmacSecret": "shared-secret", // optional — see below
    "requireSignature": true, // default true; forced false if no secret
    "maxClockSkewSeconds": 300, // default 300
  },
  "allowFrom": ["alice", "service-x"], // optional sender allowlist
}
```

### Subject templates

The outbound `subjectTemplate` supports these placeholders, derived from the
inbound subject + the configured `inbound.subject` pattern:

| Placeholder     | Meaning                                                      |
| --------------- | ------------------------------------------------------------ |
| `{subject}`     | Full inbound subject                                         |
| `{tail}`        | The `>` wildcard capture (or all `*` captures joined by `.`) |
| `{1}`, `{2}`, … | Individual `*` wildcard captures, in order                   |

Example: inbound pattern `openclaw.prompt.>`, inbound subject
`openclaw.prompt.alpha.beta`, template `openclaw.response.{tail}` → publishes on
`openclaw.response.alpha.beta`.

### Security modes

- **Signed (recommended)** — set `security.hmacSecret`. Inbound envelopes must
  carry a valid HMAC-SHA256 signature (when `requireSignature` is `true`, the
  default). Outbound envelopes are signed with the same secret.
- **Unsigned** — omit `security.hmacSecret`. `requireSignature` is forced off;
  any `signature` field on inbound envelopes is ignored; outbound envelopes are
  unsigned. Use this only when the NATS network and producers are already
  trusted.

## Envelope format

```jsonc
{
  "id": "uuid",
  "inReplyTo": "uuid of the inbound message (outbound only)",
  "timestamp": "2026-05-12T11:00:00.000Z",
  "sender": "principal",
  "signature": "base64 HMAC-SHA256(canonicalJSON(env without signature))",
  "payload": {
    // inbound:  { "prompt": "..." }
    // outbound: { "text": "..." }
  },
}
```

Canonicalization sorts object keys lexicographically before signing, so
producers in any language can compute matching signatures.

## Non-interactive install (Docker / CI)

When any flag is passed to `openclaw channels add`, the wizard is skipped and
the plugin's `setup.applyAccountConfig` runs. This implementation reads from
both CLI flags AND environment variables, so you can drive the install entirely
from env in a Dockerfile.

Recognized environment variables:

| Env var                          | Maps to                                                    | Required |
| -------------------------------- | ---------------------------------------------------------- | -------- |
| `NATS_TOKEN`                     | `channels.nats.token`                                      | no       |
| `NATS_SERVERS`                   | `channels.nats.servers` (comma-list)                       | yes      |
| `NATS_INBOUND_SUBJECT`           | `channels.nats.inbound.subject`                            | yes      |
| `NATS_QUEUE_GROUP`               | `channels.nats.inbound.queueGroup`                         | yes      |
| `NATS_OUTBOUND_SUBJECT_TEMPLATE` | `channels.nats.outbound.subjectTemplate`                   | yes      |
| `NATS_HMAC_SECRET`               | `channels.nats.security.hmacSecret`                        | no       |
| `NATS_REQUIRE_SIGNATURE`         | `channels.nats.security.requireSignature` (`true`/`false`) | no       |
| `NATS_MAX_CLOCK_SKEW_SECONDS`    | `channels.nats.security.maxClockSkewSeconds`               | no       |
| `NATS_ALLOW_FROM`                | `channels.nats.allowFrom` (comma-list)                     | no       |

CLI flags also work where they map to built-in `ChannelSetupInput` slots —
`--token`, `--secret`, `--url` — and override the corresponding env var.

```dockerfile
# Example Dockerfile snippet
RUN openclaw plugins install /opt/openclaw-nats-channel \
 && NATS_SERVERS=nats://nats:4222 \
    NATS_INBOUND_SUBJECT='openclaw.prompt.>' \
    NATS_QUEUE_GROUP=claw \
    NATS_OUTBOUND_SUBJECT_TEMPLATE='openclaw.response.{tail}' \
    NATS_TOKEN="$NATS_TOKEN" \
    openclaw channels add --channel nats --useEnv true
```

`--useEnv true` is a no-op input field that exists purely to satisfy
`openclaw channels add`'s "any flag means non-interactive" trigger.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Project layout

```
.
├── index.ts              # main plugin entry
├── setup-entry.ts        # lightweight onboarding entry
├── openclaw.plugin.json  # channel config schema
├── src/
│   ├── channel.ts        # ChannelPlugin wiring
│   ├── config.ts         # zod schema + redact()
│   ├── envelope.ts       # JSON envelope + HMAC sign/verify
│   ├── subject.ts        # NATS wildcard matcher + template resolver
│   ├── nats-client.ts    # connect / subscribe / publish
│   ├── inbound.ts        # pre-process pipeline
│   ├── outbound.ts       # post-process + publish
│   └── channel.test.ts   # tests
```

## Status

`0.01-beta` — feature-complete for the documented flow, fully tested at the
unit/contract layer, and built against the real `openclaw@2026.5.x` plugin SDK
(`createChatChannelPlugin`, `defineChannelPluginEntry`, `defineSetupPluginEntry`
from `openclaw/plugin-sdk/channel-core`). Not yet validated against a live
OpenClaw runtime; the `channelRuntime.reply.*` call shape in
`gateway.startAccount` may need tweaks once exercised end-to-end.

## Commit & PR Conventions

- Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`,
  `test:`). Scope with the moon project where useful: `feat(web): …`,
  `feat(admin): …`, `fix(api): …`, `feat(cli): …`.
- Keep commits focused; don't bundle unrelated refactors with feature work.
- PR description should state the _why_ and link the issue. Test plan belongs in
  the PR body, not the commit message.

## What NOT to do

- Don't add doc comments that just restate the code; only document the _why_
  when it isn't obvious.
- NEVER mention a co-authored-by or similar aspects. In particular, never
  mention the tool used to create the commit message or PR.
