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
export function resolveOutboundSubject(
  inboundSubject: string,
  pattern: string,
  template: string,
): string {
  const captures = matchSubject(inboundSubject, pattern);
  const tail = captures.tail ?? captures.wildcards.join(".");
  return template
    .replace(/\{subject\}/g, inboundSubject)
    .replace(/\{tail\}/g, tail)
    .replace(/\{(\d+)\}/g, (_m, idx) => captures.wildcards[Number(idx) - 1] ?? "");
}

export interface SubjectMatch {
  wildcards: string[];
  tail?: string;
}

export function matchSubject(subject: string, pattern: string): SubjectMatch {
  const subTokens = subject.split(".");
  const patTokens = pattern.split(".");
  const wildcards: string[] = [];
  let tail: string | undefined;

  for (let i = 0; i < patTokens.length; i++) {
    const p = patTokens[i];
    if (p === ">") {
      tail = subTokens.slice(i).join(".");
      return { wildcards, tail };
    }
    const s = subTokens[i];
    if (s === undefined) return { wildcards, tail };
    if (p === "*") {
      wildcards.push(s);
    }
  }
  return { wildcards, tail };
}
