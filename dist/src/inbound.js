import { decode, EnvelopeDecodeError, isFresh, verify, } from "./envelope.js";
export function preProcess(msg, config, now = new Date()) {
    let env;
    try {
        env = decode(msg.data);
    }
    catch (err) {
        return {
            ok: false,
            reason: "decode",
            detail: err instanceof EnvelopeDecodeError ? err.message : String(err),
        };
    }
    if (!env.payload ||
        typeof env.payload !== "object" ||
        typeof env.payload.prompt !== "string") {
        return { ok: false, reason: "missing-prompt" };
    }
    const secret = config.security.hmacSecret;
    if (config.security.requireSignature) {
        // requireSignature implies a secret is configured (enforced by config parser).
        if (!env.signature)
            return { ok: false, reason: "unsigned" };
        if (!secret || !verify(env, secret)) {
            return { ok: false, reason: "bad-signature" };
        }
    }
    else if (secret && env.signature && !verify(env, secret)) {
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
export function sessionKey(subject, sender) {
    return `nats:${subject}|${sender ?? "anon"}`;
}
//# sourceMappingURL=inbound.js.map