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
export declare function sign(env: Omit<NatsEnvelope, "signature">, secret: string): string;
export declare function verify(env: NatsEnvelope, secret: string): boolean;
export declare function encode<T>(env: NatsEnvelope<T>): Uint8Array;
export declare class EnvelopeDecodeError extends Error {
}
export declare function decode<T = unknown>(bytes: Uint8Array | string): NatsEnvelope<T>;
export interface BuildOptions {
    payload: unknown;
    inReplyTo?: string;
    sender?: string;
    secret?: string;
    now?: () => Date;
}
export declare function buildSigned<T = unknown>(opts: BuildOptions): NatsEnvelope<T>;
export declare function isFresh(env: NatsEnvelope, maxSkewSeconds: number, now?: Date): boolean;
//# sourceMappingURL=envelope.d.ts.map