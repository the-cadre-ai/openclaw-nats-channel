import { describe, expect, it } from "vitest";
import { natsChannelPlugin } from "./channel.js";
import { parseConfig } from "./config.js";
import {
  buildSigned,
  decode,
  encode,
  isFresh,
  sign,
  verify,
  type InboundPayload,
} from "./envelope.js";
import { preProcess } from "./inbound.js";
import { matchSubject, resolveOutboundSubject } from "./subject.js";

const baseConfig = {
  servers: "nats://localhost:4222",
  token: "tok",
  inbound: { subject: "openclaw.prompt.>", queueGroup: "claw" },
  outbound: { subjectTemplate: "openclaw.response.{tail}" },
  security: {
    hmacSecret: "shh",
    requireSignature: true,
    maxClockSkewSeconds: 300,
  },
};

describe("config", () => {
  it("parses a valid config", () => {
    const c = parseConfig(baseConfig);
    expect(c.inbound.subject).toBe("openclaw.prompt.>");
  });
  it("rejects empty hmacSecret string", () => {
    const bad = {
      ...baseConfig,
      security: { ...baseConfig.security, hmacSecret: "" },
    };
    expect(() => parseConfig(bad)).toThrow();
  });
  it("allows omitting hmacSecret and forces requireSignature off", () => {
    const { security, ...rest } = baseConfig;
    const c = parseConfig(rest);
    expect(c.security.hmacSecret).toBeUndefined();
    expect(c.security.requireSignature).toBe(false);
  });
  it("forces requireSignature off when secret is omitted even if explicitly true", () => {
    const c = parseConfig({
      ...baseConfig,
      security: { requireSignature: true },
    });
    expect(c.security.requireSignature).toBe(false);
  });
  it("allows omitting token entirely (servers without auth)", () => {
    const { token, ...rest } = baseConfig;
    const c = parseConfig(rest);
    expect(c.token).toBeUndefined();
  });
  it("rejects empty token string", () => {
    expect(() => parseConfig({ ...baseConfig, token: "" })).toThrow();
  });
});

describe("envelope", () => {
  it("signs and verifies round-trip", () => {
    const env = buildSigned({
      payload: { prompt: "hi" },
      sender: "alice",
      secret: "shh",
    });
    expect(verify(env, "shh")).toBe(true);
  });

  it("detects tampered payload", () => {
    const env = buildSigned<InboundPayload>({
      payload: { prompt: "hi" },
      sender: "alice",
      secret: "shh",
    });
    env.payload.prompt = "evil";
    expect(verify(env, "shh")).toBe(false);
  });

  it("detects wrong secret", () => {
    const env = buildSigned({ payload: { prompt: "hi" }, secret: "shh" });
    expect(verify(env, "nope")).toBe(false);
  });

  it("encode/decode round-trip", () => {
    const env = buildSigned({ payload: { prompt: "hi" }, secret: "shh" });
    const back = decode(encode(env));
    expect(back.id).toBe(env.id);
    expect(back.signature).toBe(env.signature);
  });

  it("isFresh respects skew", () => {
    const env = buildSigned({ payload: { prompt: "hi" }, secret: "shh" });
    const future = new Date(Date.parse(env.timestamp) + 1000 * 1000); // +1000s
    expect(isFresh(env, 300, future)).toBe(false);
  });

  it("canonicalization is order-independent", () => {
    const sig1 = sign(
      { id: "1", timestamp: "2026-05-12T00:00:00Z", payload: { a: 1, b: 2 } },
      "shh",
    );
    const sig2 = sign(
      { id: "1", timestamp: "2026-05-12T00:00:00Z", payload: { b: 2, a: 1 } },
      "shh",
    );
    expect(sig1).toBe(sig2);
  });
});

describe("subject", () => {
  it("captures > tail", () => {
    expect(
      matchSubject("openclaw.prompt.alpha.beta", "openclaw.prompt.>").tail,
    ).toBe("alpha.beta");
  });
  it("captures * wildcards positionally", () => {
    const m = matchSubject("a.b.c", "a.*.*");
    expect(m.wildcards).toEqual(["b", "c"]);
  });
  it("resolves template with {tail}", () => {
    expect(
      resolveOutboundSubject(
        "openclaw.prompt.alpha.beta",
        "openclaw.prompt.>",
        "openclaw.response.{tail}",
      ),
    ).toBe("openclaw.response.alpha.beta");
  });
  it("resolves template with positional captures", () => {
    expect(resolveOutboundSubject("a.b.c", "a.*.*", "out.{2}.{1}")).toBe(
      "out.c.b",
    );
  });
});

describe("preProcess", () => {
  const cfg = parseConfig(baseConfig);

  function inbound(env: unknown, subject = "openclaw.prompt.x") {
    return {
      subject,
      data: new TextEncoder().encode(JSON.stringify(env)),
    };
  }

  it("accepts a well-signed fresh envelope", () => {
    const env = buildSigned({
      payload: { prompt: "hello" },
      sender: "alice",
      secret: "shh",
    });
    const decision = preProcess(inbound(env), cfg);
    expect(decision.ok).toBe(true);
  });

  it("rejects garbage JSON", () => {
    const decision = preProcess(
      {
        subject: "openclaw.prompt.x",
        data: new TextEncoder().encode("not json"),
      },
      cfg,
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("decode");
  });

  it("rejects missing prompt", () => {
    const env = buildSigned({ payload: { not_a_prompt: 1 }, secret: "shh" });
    const decision = preProcess(inbound(env), cfg);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("missing-prompt");
  });

  it("rejects unsigned when requireSignature", () => {
    const env = buildSigned({ payload: { prompt: "x" } /* no secret */ });
    const decision = preProcess(inbound(env), cfg);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("unsigned");
  });

  it("rejects tampered signature", () => {
    const env = buildSigned<InboundPayload>({
      payload: { prompt: "x" },
      secret: "shh",
    });
    env.payload.prompt = "y";
    const decision = preProcess(inbound(env), cfg);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("bad-signature");
  });

  it("rejects stale timestamp", () => {
    const env = buildSigned({
      payload: { prompt: "x" },
      secret: "shh",
      now: () => new Date(Date.now() - 1000 * 1000),
    });
    const decision = preProcess(inbound(env), cfg);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("stale");
  });

  it("accepts unsigned envelope when no secret is configured", () => {
    const cfgNoSecret = parseConfig({ ...baseConfig, security: {} });
    const env = buildSigned({ payload: { prompt: "hello" }, sender: "alice" });
    expect(env.signature).toBeUndefined();
    const decision = preProcess(inbound(env), cfgNoSecret);
    expect(decision.ok).toBe(true);
  });

  it("ignores signature when no secret is configured", () => {
    const cfgNoSecret = parseConfig({ ...baseConfig, security: {} });
    const env = buildSigned({
      payload: { prompt: "hello" },
      secret: "different-secret",
    });
    const decision = preProcess(inbound(env), cfgNoSecret);
    expect(decision.ok).toBe(true);
  });

  it("enforces allowFrom", () => {
    const cfgWithAllow = parseConfig({ ...baseConfig, allowFrom: ["alice"] });
    const env = buildSigned({
      payload: { prompt: "x" },
      sender: "mallory",
      secret: "shh",
    });
    const decision = preProcess(inbound(env), cfgWithAllow);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("not-allowed");
  });
});

describe("non-interactive setup (applyAccountConfig)", () => {
  const apply = (
    cfg: unknown,
    input: Record<string, unknown>,
    env: Record<string, string>,
  ) => {
    const saved: Record<string, string | undefined> = {};
    const envKeys = [
      "NATS_TOKEN",
      "NATS_SERVERS",
      "NATS_INBOUND_SUBJECT",
      "NATS_QUEUE_GROUP",
      "NATS_OUTBOUND_SUBJECT_TEMPLATE",
      "NATS_HMAC_SECRET",
      "NATS_REQUIRE_SIGNATURE",
      "NATS_MAX_CLOCK_SKEW_SECONDS",
      "NATS_ALLOW_FROM",
    ];
    for (const k of envKeys) {
      saved[k] = process.env[k];
      if (env[k] !== undefined) process.env[k] = env[k];
      else delete process.env[k];
    }
    try {
      return (
        natsChannelPlugin.setup as { applyAccountConfig: Function }
      ).applyAccountConfig({
        cfg,
        accountId: "default",
        input,
      });
    } finally {
      for (const k of envKeys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k]!;
      }
    }
  };

  it("populates config from env vars", () => {
    const out = apply(
      {},
      {},
      {
        NATS_TOKEN: "envtok",
        NATS_SERVERS: "nats://a:4222,nats://b:4222",
        NATS_INBOUND_SUBJECT: "openclaw.prompt.>",
        NATS_QUEUE_GROUP: "claw-workers",
        NATS_OUTBOUND_SUBJECT_TEMPLATE: "openclaw.response.{tail}",
        NATS_HMAC_SECRET: "shh",
        NATS_ALLOW_FROM: "alice,bob",
      },
    );
    const nats = (out as { channels: { nats: Record<string, unknown> } })
      .channels.nats;
    expect(nats.token).toBe("envtok");
    expect(nats.servers).toEqual(["nats://a:4222", "nats://b:4222"]);
    expect(nats.inbound).toEqual({
      subject: "openclaw.prompt.>",
      queueGroup: "claw-workers",
    });
    expect(nats.outbound).toEqual({
      subjectTemplate: "openclaw.response.{tail}",
    });
    expect((nats.security as Record<string, unknown>).hmacSecret).toBe("shh");
    expect(nats.allowFrom).toEqual(["alice", "bob"]);
  });

  it("CLI flags override env vars (input wins)", () => {
    const out = apply(
      {},
      { token: "flagtok", url: "nats://flag:4222" },
      { NATS_TOKEN: "envtok", NATS_SERVERS: "nats://env:4222" },
    );
    const nats = (out as { channels: { nats: Record<string, unknown> } })
      .channels.nats;
    expect(nats.token).toBe("flagtok");
    expect(nats.servers).toBe("nats://flag:4222");
  });

  it("omits token when neither flag nor env var is set", () => {
    const out = apply({}, {}, { NATS_SERVERS: "nats://x:4222" });
    const nats = (out as { channels: { nats: Record<string, unknown> } })
      .channels.nats;
    expect(nats.token).toBeUndefined();
    expect(nats.servers).toBe("nats://x:4222");
  });
});
