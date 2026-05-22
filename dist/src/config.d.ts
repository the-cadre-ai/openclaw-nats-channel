import { z } from "zod";
export declare const NatsChannelConfigSchema: z.ZodObject<{
    servers: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>;
    token: z.ZodOptional<z.ZodString>;
    inbound: z.ZodObject<{
        subject: z.ZodString;
        queueGroup: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        subject: string;
        queueGroup: string;
    }, {
        subject: string;
        queueGroup: string;
    }>;
    outbound: z.ZodObject<{
        subjectTemplate: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        subjectTemplate: string;
    }, {
        subjectTemplate: string;
    }>;
    security: z.ZodEffects<z.ZodDefault<z.ZodObject<{
        hmacSecret: z.ZodOptional<z.ZodString>;
        requireSignature: z.ZodDefault<z.ZodBoolean>;
        maxClockSkewSeconds: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        requireSignature: boolean;
        maxClockSkewSeconds: number;
        hmacSecret?: string | undefined;
    }, {
        hmacSecret?: string | undefined;
        requireSignature?: boolean | undefined;
        maxClockSkewSeconds?: number | undefined;
    }>>, {
        requireSignature: boolean;
        maxClockSkewSeconds: number;
        hmacSecret?: string | undefined;
    }, {
        hmacSecret?: string | undefined;
        requireSignature?: boolean | undefined;
        maxClockSkewSeconds?: number | undefined;
    } | undefined>;
    allowFrom: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    servers: string | string[];
    inbound: {
        subject: string;
        queueGroup: string;
    };
    outbound: {
        subjectTemplate: string;
    };
    security: {
        requireSignature: boolean;
        maxClockSkewSeconds: number;
        hmacSecret?: string | undefined;
    };
    token?: string | undefined;
    allowFrom?: string[] | undefined;
}, {
    servers: string | string[];
    inbound: {
        subject: string;
        queueGroup: string;
    };
    outbound: {
        subjectTemplate: string;
    };
    token?: string | undefined;
    security?: {
        hmacSecret?: string | undefined;
        requireSignature?: boolean | undefined;
        maxClockSkewSeconds?: number | undefined;
    } | undefined;
    allowFrom?: string[] | undefined;
}>;
export type NatsChannelConfig = z.infer<typeof NatsChannelConfigSchema>;
export declare function parseConfig(raw: unknown): NatsChannelConfig;
export declare function redact(config: NatsChannelConfig): Record<string, unknown>;
//# sourceMappingURL=config.d.ts.map