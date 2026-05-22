import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
function canonicalize(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return "[" + value.map(canonicalize).join(",") + "]";
    const keys = Object.keys(value).sort();
    return ("{" +
        keys
            .map((k) => JSON.stringify(k) +
            ":" +
            canonicalize(value[k]))
            .join(",") +
        "}");
}
function signableBytes(env) {
    return canonicalize({
        id: env.id,
        inReplyTo: env.inReplyTo,
        timestamp: env.timestamp,
        sender: env.sender,
        payload: env.payload,
    });
}
export function sign(env, secret) {
    return createHmac("sha256", secret)
        .update(signableBytes(env))
        .digest("base64");
}
export function verify(env, secret) {
    if (!env.signature)
        return false;
    const expected = sign(env, secret);
    const a = Buffer.from(expected, "base64");
    const b = Buffer.from(env.signature, "base64");
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(a, b);
}
export function encode(env) {
    return new TextEncoder().encode(JSON.stringify(env));
}
export class EnvelopeDecodeError extends Error {
}
export function decode(bytes) {
    let text;
    try {
        text = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
    }
    catch (err) {
        throw new EnvelopeDecodeError("Failed to decode bytes as UTF-8");
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (err) {
        throw new EnvelopeDecodeError("Envelope is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object") {
        throw new EnvelopeDecodeError("Envelope must be a JSON object");
    }
    const obj = parsed;
    if (typeof obj.id !== "string" || typeof obj.timestamp !== "string") {
        throw new EnvelopeDecodeError("Envelope missing required id/timestamp");
    }
    if (!("payload" in obj)) {
        throw new EnvelopeDecodeError("Envelope missing payload");
    }
    return parsed;
}
export function buildSigned(opts) {
    const base = {
        id: randomUUID(),
        inReplyTo: opts.inReplyTo,
        timestamp: (opts.now ? opts.now() : new Date()).toISOString(),
        sender: opts.sender,
        payload: opts.payload,
    };
    const env = { ...base };
    if (opts.secret)
        env.signature = sign(base, opts.secret);
    return env;
}
export function isFresh(env, maxSkewSeconds, now = new Date()) {
    const t = Date.parse(env.timestamp);
    if (Number.isNaN(t))
        return false;
    return Math.abs(now.getTime() - t) <= maxSkewSeconds * 1000;
}
//# sourceMappingURL=envelope.js.map