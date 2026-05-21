// NATS channel plugin — built against the openclaw 2026.5.x plugin SDK.
//
// The pure logic modules (config, envelope, subject, nats-client, inbound,
// outbound) are SDK-independent. This file is the SDK-binding layer.

import {
  createChatChannelPlugin,
  type ChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/channel-core";
import {
  createStandardChannelSetupStatus,
  patchTopLevelChannelConfigSection,
  type ChannelSetupWizard,
} from "openclaw/plugin-sdk/setup";

import {
  NatsChannelConfigSchema,
  parseConfig,
  redact,
  type NatsChannelConfig,
} from "./config.js";
import { preProcess, sessionKey } from "./inbound.js";
import { NatsClient, type InboundMessage } from "./nats-client.js";
import { sendText as natsSendText } from "./outbound.js";

export const PLUGIN_ID = "openclaw-nats-channel";
export const CHANNEL_ID = "nats" as const;

export type ResolvedNatsAccount = NatsChannelConfig & {
  accountId: string;
};

// One NATS connection per resolved account, kept alive for the duration of
// the gateway lifecycle (started in `gateway.startAccount`, drained in
// `gateway.stopAccount`).
const liveClients = new Map<string, NatsClient>();

// ----- Config reading ----------------------------------------------------

function readRawAccountConfig(
  cfg: OpenClawConfig,
  accountId?: string | null,
): unknown {
  // OpenClaw stores channel config under `cfg.channels.<channelId>`. For
  // multi-account channels the per-account config lives under
  // `.accounts.<accountId>`; otherwise the top-level block is the single
  // account.
  const channels = (cfg as unknown as { channels?: Record<string, unknown> }).channels;
  const block = channels?.[CHANNEL_ID];
  if (!block || typeof block !== "object") return {};
  const accounts = (block as { accounts?: Record<string, unknown> }).accounts;
  if (accountId && accounts && typeof accounts[accountId] === "object") {
    return accounts[accountId];
  }
  return block;
}

function listAccountIds(cfg: OpenClawConfig): string[] {
  const channels = (cfg as unknown as { channels?: Record<string, unknown> }).channels;
  const block = channels?.[CHANNEL_ID];
  if (!block || typeof block !== "object") return [];
  const accounts = (block as { accounts?: Record<string, unknown> }).accounts;
  if (accounts && typeof accounts === "object") return Object.keys(accounts);
  // Single-account channel: the block itself is the account.
  return ["default"];
}

function resolveAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedNatsAccount {
  const raw = readRawAccountConfig(cfg, accountId);
  const parsed = parseConfig(raw);
  return { ...parsed, accountId: accountId ?? "default" };
}

function inspectAccount(cfg: OpenClawConfig, accountId?: string | null): unknown {
  const raw = readRawAccountConfig(cfg, accountId);
  const parsed = NatsChannelConfigSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.format() };
  return { ok: true, account: redact(parsed.data), accountId: accountId ?? "default" };
}

// ----- Setup wizard ------------------------------------------------------
//
// Powers `openclaw channels add --channel nats`. `inputKey` values are slots
// drawn from `ChannelSetupInput`; the actual writes happen in each `applySet`
// callback, which patches `cfg.channels.nats.*` via the SDK helper.

function applyNatsPatch(
  cfg: OpenClawConfig,
  patch: Record<string, unknown>,
): OpenClawConfig {
  return patchTopLevelChannelConfigSection({
    cfg,
    channel: CHANNEL_ID,
    enabled: true,
    patch,
  });
}

function readNatsField<T = unknown>(
  cfg: OpenClawConfig,
  path: readonly string[],
): T | undefined {
  let cur: unknown = (cfg as unknown as { channels?: Record<string, unknown> }).channels?.[
    CHANNEL_ID
  ];
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur as T | undefined;
}

const natsSetupWizard: ChannelSetupWizard = {
  channel: CHANNEL_ID,
  status: createStandardChannelSetupStatus({
    channelLabel: "NATS",
    configuredLabel: "configured",
    unconfiguredLabel: "needs token + subjects",
    configuredHint: "ready",
    unconfiguredHint: "needs token, inbound subject, outbound template",
    configuredScore: 1,
    unconfiguredScore: 0,
    includeStatusLine: true,
    resolveConfigured: ({ cfg }) => {
      const inboundSubject = readNatsField<string>(cfg, ["inbound", "subject"]);
      const outboundTemplate = readNatsField<string>(cfg, [
        "outbound",
        "subjectTemplate",
      ]);
      return Boolean(inboundSubject && outboundTemplate);
    },
  }),
  introNote: {
    title: "NATS setup",
    lines: [
      "NATS needs at minimum: server URL, inbound subject, queue group, and outbound subject template.",
      "Optional: auth token (leave blank for servers without auth) and shared HMAC secret to sign/verify envelopes.",
      "Subject template tokens: {tail} (>-capture), {subject} (full), {1}/{2}/… (*-captures).",
    ],
    shouldShow: ({ cfg }) => !readNatsField(cfg, ["inbound", "subject"]),
  },
  credentials: [
    {
      inputKey: "token",
      providerHint: "nats",
      credentialLabel: "NATS auth token (optional)",
      preferredEnvVar: "NATS_TOKEN",
      envPrompt: "Use NATS_TOKEN from environment?",
      keepPrompt: "Keep current NATS token?",
      inputPrompt: "Enter NATS auth token (leave blank if the server requires no auth):",
      inspect: ({ cfg }) => {
        const token = readNatsField<string>(cfg, ["token"]);
        // A configured-but-tokenless account is still valid; mark as configured
        // so the wizard doesn't insist on a value.
        return {
          accountConfigured: true,
          hasConfiguredValue: Boolean(token),
          resolvedValue: token,
        };
      },
      applySet: ({ cfg, resolvedValue }) => {
        if (resolvedValue) return applyNatsPatch(cfg, { token: resolvedValue });
        // Empty/blank: clear any previously stored token so re-running setup
        // can drop auth without leaving stale credentials behind.
        return patchTopLevelChannelConfigSection({
          cfg,
          channel: CHANNEL_ID,
          enabled: true,
          clearFields: ["token"],
          patch: {},
        });
      },
    },
    {
      inputKey: "secret",
      providerHint: "nats",
      credentialLabel: "Envelope HMAC secret (optional)",
      preferredEnvVar: "NATS_HMAC_SECRET",
      envPrompt: "Use NATS_HMAC_SECRET from environment?",
      keepPrompt: "Keep current HMAC secret?",
      inputPrompt: "Enter HMAC secret (blank = unsigned envelopes):",
      inspect: ({ cfg }) => {
        const secret = readNatsField<string>(cfg, ["security", "hmacSecret"]);
        return {
          accountConfigured: Boolean(secret),
          hasConfiguredValue: Boolean(secret),
          resolvedValue: secret,
        };
      },
      applySet: ({ cfg, resolvedValue }) => {
        const security = {
          ...(readNatsField<Record<string, unknown>>(cfg, ["security"]) ?? {}),
          hmacSecret: resolvedValue || undefined,
        };
        if (!resolvedValue) delete (security as Record<string, unknown>).hmacSecret;
        return applyNatsPatch(cfg, { security });
      },
    },
  ],
  textInputs: [
    {
      inputKey: "url",
      message: "NATS server URL (e.g. nats://localhost:4222)",
      required: true,
      currentValue: ({ cfg }) => {
        const v = readNatsField<string | string[]>(cfg, ["servers"]);
        return Array.isArray(v) ? v.join(",") : v;
      },
      validate: ({ value }) => (value.trim() ? undefined : "Required"),
      applySet: ({ cfg, value }) => {
        const list = value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        return applyNatsPatch(cfg, { servers: list.length === 1 ? list[0] : list });
      },
    },
    {
      inputKey: "httpHost",
      message: "Inbound subject (NATS wildcards allowed, e.g. openclaw.prompt.>)",
      required: true,
      currentValue: ({ cfg }) => readNatsField<string>(cfg, ["inbound", "subject"]),
      validate: ({ value }) => (value.trim() ? undefined : "Required"),
      applySet: ({ cfg, value }) => {
        const inbound = {
          ...(readNatsField<Record<string, unknown>>(cfg, ["inbound"]) ?? {}),
          subject: value.trim(),
        };
        return applyNatsPatch(cfg, { inbound });
      },
    },
    {
      inputKey: "httpPort",
      message: "Inbound queue group",
      required: true,
      currentValue: ({ cfg }) =>
        readNatsField<string>(cfg, ["inbound", "queueGroup"]),
      validate: ({ value }) => (value.trim() ? undefined : "Required"),
      applySet: ({ cfg, value }) => {
        const inbound = {
          ...(readNatsField<Record<string, unknown>>(cfg, ["inbound"]) ?? {}),
          queueGroup: value.trim(),
        };
        return applyNatsPatch(cfg, { inbound });
      },
    },
    {
      inputKey: "webhookPath",
      message: "Outbound subject template (e.g. openclaw.response.{tail})",
      required: true,
      currentValue: ({ cfg }) =>
        readNatsField<string>(cfg, ["outbound", "subjectTemplate"]),
      validate: ({ value }) => (value.trim() ? undefined : "Required"),
      applySet: ({ cfg, value }) => {
        const outbound = {
          ...(readNatsField<Record<string, unknown>>(cfg, ["outbound"]) ?? {}),
          subjectTemplate: value.trim(),
        };
        return applyNatsPatch(cfg, { outbound });
      },
    },
  ],
  completionNote: {
    title: "NATS configured",
    lines: [
      "Restart the OpenClaw gateway to load the NATS subscription.",
      "Publish a signed envelope to the configured inbound subject to test end-to-end.",
    ],
  },
};

// ----- Plugin literal ----------------------------------------------------

export const natsChannelPlugin: ChannelPlugin<ResolvedNatsAccount> =
  createChatChannelPlugin<ResolvedNatsAccount>({
    base: {
      id: CHANNEL_ID,
      setupWizard: natsSetupWizard,
      meta: {
        id: CHANNEL_ID,
        label: "NATS",
        selectionLabel: "NATS",
        docsPath: "/plugins/openclaw-nats-channel",
        blurb:
          "Treat inbound NATS messages as prompts and publish LLM responses back to NATS.",
        markdownCapable: false,
      },
      capabilities: {
        chatTypes: ["direct"],
        polls: false,
        reactions: false,
        edit: false,
        unsend: false,
        reply: true,
        media: false,
        threads: false,
      },
      config: {
        listAccountIds,
        resolveAccount,
        inspectAccount,
        defaultAccountId: (_cfg) => "default",
        isConfigured: (account) =>
          Boolean(account.inbound?.subject && account.outbound?.subjectTemplate),
        unconfiguredReason: (account) => {
          if (!account.inbound?.subject) return "missing inbound.subject";
          if (!account.outbound?.subjectTemplate) return "missing outbound.subjectTemplate";
          return "";
        },
        resolveAllowFrom: ({ cfg, accountId }) => {
          const acct = resolveAccount(cfg, accountId);
          return acct.allowFrom;
        },
      },
      gateway: {
        startAccount: async (ctx) => {
          const client = new NatsClient({
            servers: ctx.account.servers,
            token: ctx.account.token,
          });
          await client.connect();
          liveClients.set(ctx.accountId, client);

          ctx.abortSignal.addEventListener("abort", () => {
            void client.drain().catch(() => {});
            liveClients.delete(ctx.accountId);
          });

          await client.subscribe(
            ctx.account.inbound.subject,
            ctx.account.inbound.queueGroup,
            async (msg: InboundMessage) => {
              const decision = preProcess(msg, ctx.account);
              if (!decision.ok) {
                ctx.log?.warn(
                  `inbound rejected: reason=${decision.reason}${decision.detail ? ` detail=${decision.detail}` : ""}`,
                );
                return;
              }

              const env = decision.envelope;
              const baseConversationId = sessionKey(msg.subject, env.sender);

              // Hand the prompt to OpenClaw's reply dispatcher when the
              // channel runtime surface is available. External plugins
              // should always defensively check for `channelRuntime`.
              if (!ctx.channelRuntime) {
                ctx.log?.warn(
                  "channelRuntime unavailable — inbound NATS prompt cannot be dispatched to the agent",
                );
                return;
              }

              // ChannelRuntimeSurface is intentionally typed loosely for
              // external plugins (per SDK docs). Cast to `any` for the call.
              const runtimeReply = (ctx.channelRuntime as unknown as {
                reply: {
                  dispatchReplyWithBufferedBlockDispatcher: (args: {
                    ctx: Record<string, unknown>;
                    cfg: OpenClawConfig;
                    dispatcherOptions: {
                      deliver: (payload: { text?: string }) => Promise<void> | void;
                    };
                  }) => Promise<void>;
                };
              }).reply;

              try {
                await runtimeReply.dispatchReplyWithBufferedBlockDispatcher({
                  ctx: {
                    cfg: ctx.cfg,
                    accountId: ctx.accountId,
                    channel: CHANNEL_ID,
                    from: env.sender ?? "anon",
                    to: msg.subject,
                    text: env.payload.prompt,
                    sessionKey: baseConversationId,
                  },
                  cfg: ctx.cfg,
                  dispatcherOptions: {
                    deliver: async (payload: { text?: string }) => {
                      if (!payload.text) return;
                      const c = liveClients.get(ctx.accountId);
                      if (!c) return;
                      await natsSendText(c, ctx.account, {
                        ctx: {
                          inboundSubject: msg.subject,
                          inboundEnvelopeId: env.id,
                          inboundReplyTo: msg.reply,
                        },
                        text: payload.text,
                        pluginId: CHANNEL_ID,
                      });
                    },
                  },
                });
              } catch (err) {
                ctx.log?.error(`inbound dispatch failed: ${String(err)}`);
              }
            },
          );

          ctx.log?.info(
            `nats: subscribed subject="${ctx.account.inbound.subject}" queue="${ctx.account.inbound.queueGroup}"`,
          );
        },

        stopAccount: async (ctx) => {
          const client = liveClients.get(ctx.accountId);
          if (client) {
            await client.drain().catch(() => {});
            liveClients.delete(ctx.accountId);
          }
        },
      },
    },

    security: {
      dm: {
        channelKey: CHANNEL_ID,
        resolvePolicy: (account) =>
          account.allowFrom && account.allowFrom.length > 0 ? "allowlist" : "open",
        resolveAllowFrom: (account) => account.allowFrom ?? null,
        defaultPolicy: "allowlist",
      },
    },

    outbound: {
      base: {
        deliveryMode: "direct",
      },
      attachedResults: {
        channel: CHANNEL_ID,
        sendText: async (ctx) => {
          const account = resolveAccount(ctx.cfg, ctx.accountId ?? null);
          const client = liveClients.get(account.accountId);
          if (!client) {
            throw new Error(
              `NATS client not started for account "${account.accountId}"; ensure gateway.startAccount has run`,
            );
          }
          const receipt = await natsSendText(client, account, {
            ctx: {
              inboundSubject: ctx.to,
              inboundEnvelopeId: ctx.replyToId ?? "",
              inboundReplyTo: undefined,
            },
            text: ctx.text,
            pluginId: CHANNEL_ID,
          });
          return { messageId: receipt.id };
        },
      },
    },
  });
