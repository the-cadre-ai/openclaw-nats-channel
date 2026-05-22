/**
 * Resolve the outbound subject from the inbound subject + configured pattern + template.
 *
 * Patterns follow NATS wildcards:
 *   - `*` matches exactly one token
 *   - `>` matches one or more trailing tokens
 *
 * Template placeholders:
 *   - `{subject}`   — the full inbound subject
 *   - `{tail}`      — captured `>` portion (or all `*` captures joined by `.`)
 *   - `{1}`,`{2}`…  — individual wildcard captures in order
 */
export declare function resolveOutboundSubject(inboundSubject: string, pattern: string, template: string): string;
export interface SubjectMatch {
    wildcards: string[];
    tail?: string;
}
export declare function matchSubject(subject: string, pattern: string): SubjectMatch;
//# sourceMappingURL=subject.d.ts.map