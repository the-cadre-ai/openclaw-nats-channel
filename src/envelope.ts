import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface NatsEnvelope<T = unknown> {
  id: string;
  inReplyTo?: string;
  timestamp: string;
  sender?: string;
  signature?: string;
  payload: T;
}

export interface InboundPayload {
  prompt: string;
  [key: string]: unknown;
}

export interface OutboundPayload {
  text: string;
  [key: string]: unknown;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonicalize((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}

function signableBytes(env: Omit<NatsEnvelope, "signature">): string {
  return canonicalize({
    id: env.id,
    inReplyTo: env.inReplyTo,
    timestamp: env.timestamp,
    sender: env.sender,
    payload: env.payload,
  });
}

export function sign(
  env: Omit<NatsEnvelope, "signature">,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(signableBytes(env))
    .digest("base64");
}

export function verify(env: NatsEnvelope, secret: string): boolean {
  if (!env.signature) return false;
  const expected = sign(env, secret);
  const a = Buffer.from(expected, "base64");
  const b = Buffer.from(env.signature, "base64");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function encode<T>(env: NatsEnvelope<T>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(env));
}

export class EnvelopeDecodeError extends Error {}

export function decode<T = unknown>(
  bytes: Uint8Array | string,
): NatsEnvelope<T> {
  let text: string;
  try {
    text = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
  } catch (err) {
    throw new EnvelopeDecodeError("Failed to decode bytes as UTF-8");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new EnvelopeDecodeError("Envelope is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new EnvelopeDecodeError("Envelope must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.timestamp !== "string") {
    throw new EnvelopeDecodeError("Envelope missing required id/timestamp");
  }
  if (!("payload" in obj)) {
    throw new EnvelopeDecodeError("Envelope missing payload");
  }
  return parsed as NatsEnvelope<T>;
}

export interface BuildOptions {
  payload: unknown;
  inReplyTo?: string;
  sender?: string;
  secret?: string;
  now?: () => Date;
}

export function buildSigned<T = unknown>(opts: BuildOptions): NatsEnvelope<T> {
  const base: Omit<NatsEnvelope<T>, "signature"> = {
    id: randomUUID(),
    inReplyTo: opts.inReplyTo,
    timestamp: (opts.now ? opts.now() : new Date()).toISOString(),
    sender: opts.sender,
    payload: opts.payload as T,
  };
  const env: NatsEnvelope<T> = { ...base };
  if (opts.secret) env.signature = sign(base, opts.secret);
  return env;
}

export function isFresh(
  env: NatsEnvelope,
  maxSkewSeconds: number,
  now: Date = new Date(),
): boolean {
  const t = Date.parse(env.timestamp);
  if (Number.isNaN(t)) return false;
  return Math.abs(now.getTime() - t) <= maxSkewSeconds * 1000;
}
