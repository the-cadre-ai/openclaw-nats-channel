import type { NatsChannelConfig } from "./config.js";
import {
  decode,
  EnvelopeDecodeError,
  isFresh,
  verify,
  type InboundPayload,
  type NatsEnvelope,
} from "./envelope.js";
import type { InboundMessage } from "./nats-client.js";

export type RejectReason =
  | "decode"
  | "missing-prompt"
  | "unsigned"
  | "bad-signature"
  | "stale"
  | "not-allowed";

export interface AcceptedInbound {
  ok: true;
  subject: string;
  reply?: string;
  envelope: NatsEnvelope<InboundPayload>;
}

export interface RejectedInbound {
  ok: false;
  reason: RejectReason;
  detail?: string;
}

export type InboundDecision = AcceptedInbound | RejectedInbound;

export function preProcess(
  msg: InboundMessage,
  config: NatsChannelConfig,
  now: Date = new Date(),
): InboundDecision {
  let env: NatsEnvelope<InboundPayload>;
  try {
    env = decode<InboundPayload>(msg.data);
  } catch (err) {
    return {
      ok: false,
      reason: "decode",
      detail: err instanceof EnvelopeDecodeError ? err.message : String(err),
    };
  }

  if (
    !env.payload ||
    typeof env.payload !== "object" ||
    typeof env.payload.prompt !== "string"
  ) {
    return { ok: false, reason: "missing-prompt" };
  }

  const secret = config.security.hmacSecret;
  if (config.security.requireSignature) {
    // requireSignature implies a secret is configured (enforced by config parser).
    if (!env.signature) return { ok: false, reason: "unsigned" };
    if (!secret || !verify(env, secret)) {
      return { ok: false, reason: "bad-signature" };
    }
  } else if (secret && env.signature && !verify(env, secret)) {
    // If a secret is configured and the producer signed, a mismatch is a tamper signal.
    return { ok: false, reason: "bad-signature" };
  }
  // No secret configured: signatures (if present) are ignored entirely.

  if (!isFresh(env, config.security.maxClockSkewSeconds, now)) {
    return { ok: false, reason: "stale" };
  }

  if (config.allowFrom && config.allowFrom.length > 0) {
    if (!env.sender || !config.allowFrom.includes(env.sender)) {
      return { ok: false, reason: "not-allowed" };
    }
  }

  return { ok: true, subject: msg.subject, reply: msg.reply, envelope: env };
}

export function sessionKey(
  subject: string,
  sender: string | undefined,
): string {
  return `nats:${subject}|${sender ?? "anon"}`;
}
