import { z } from "zod";
export const NatsChannelConfigSchema = z.object({
    servers: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    token: z.string().min(1).optional(),
    inbound: z.object({
        subject: z.string().min(1),
        queueGroup: z.string().min(1),
    }),
    outbound: z.object({
        subjectTemplate: z.string().min(1),
    }),
    security: z
        .object({
        hmacSecret: z.string().min(1).optional(),
        requireSignature: z.boolean().default(true),
        maxClockSkewSeconds: z.number().positive().default(300),
    })
        .default({})
        .transform((s) => ({
        // When no secret is configured, signing/verification is disabled entirely
        // regardless of requireSignature.
        ...s,
        requireSignature: s.hmacSecret ? s.requireSignature : false,
    })),
    allowFrom: z.array(z.string()).optional(),
});
export function parseConfig(raw) {
    return NatsChannelConfigSchema.parse(raw);
}
export function redact(config) {
    return {
        servers: config.servers,
        token: config.token ? "***" : undefined,
        inbound: config.inbound,
        outbound: config.outbound,
        security: {
            hmacSecret: config.security.hmacSecret ? "***" : undefined,
            requireSignature: config.security.requireSignature,
            maxClockSkewSeconds: config.security.maxClockSkewSeconds,
        },
        allowFrom: config.allowFrom,
    };
}
//# sourceMappingURL=config.js.map