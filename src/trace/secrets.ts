// Credential detection and masking.
//
// Separate from provider-id detection (neutrality.ts): a provider id in a trace
// is a hygiene failure, a credential is a leak. Credential patterns are matched
// anywhere in a string (unanchored), so "Authorization: Bearer sk-ant-…" is
// caught even when embedded in prose or an error message.
//
// Callers can pass the literal secret values they know about (for example the
// API key read from an intercepted request header) so a key with an unknown
// format is still caught. Literal values are never echoed back: findings are
// reported by label only, and maskSecrets replaces every match.

interface CredentialPattern {
  label: string;
  pattern: RegExp;
  /** Env-var NAMES are flagged in traces but are not secrets, so never masked. */
  maskable: boolean;
}

const CREDENTIAL_PATTERNS: readonly CredentialPattern[] = [
  { label: "sk-ant", pattern: /sk-ant-?[A-Za-z0-9_-]*/g, maskable: true },
  { label: "sk-proj", pattern: /sk-proj-[A-Za-z0-9_-]*/g, maskable: true },
  { label: "sk-", pattern: /\bsk-[A-Za-z0-9_-]{20,}/g, maskable: true },
  { label: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, maskable: true },
  { label: "ANTHROPIC_API_KEY", pattern: /ANTHROPIC_API_KEY/g, maskable: false },
  { label: "OPENAI_API_KEY", pattern: /OPENAI_API_KEY/g, maskable: false },
];

/** Minimum length for a caller-supplied literal secret to be scanned for. */
const MIN_LITERAL_LENGTH = 4;

function usableLiterals(literals: readonly (string | undefined)[]): string[] {
  return literals.filter(
    (value): value is string => typeof value === "string" && value.length >= MIN_LITERAL_LENGTH,
  );
}

// Realistic key shapes only. Used inside user data (tool results, message text),
// where source code that merely mentions "sk-ant" or an env-var name is normal.
const STRONG_CREDENTIAL_PATTERNS: readonly CredentialPattern[] = [
  { label: "sk-ant", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g, maskable: true },
  { label: "sk-proj", pattern: /sk-proj-[A-Za-z0-9_-]{20,}/g, maskable: true },
  { label: "sk-", pattern: /\bsk-[A-Za-z0-9_-]{32,}/g, maskable: true },
  { label: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, maskable: true },
];

export interface FindCredentialsOptions {
  /** Only realistic key shapes (plus literals); for scanning user content. */
  strongOnly?: boolean;
}

/**
 * Labels of every credential found in `text`. A caller-supplied literal secret
 * is reported as `<api-key-value>`.
 */
export function findCredentials(
  text: string,
  literals: readonly (string | undefined)[] = [],
  options: FindCredentialsOptions = {},
): string[] {
  const found = new Set<string>();
  const patterns = options.strongOnly === true ? STRONG_CREDENTIAL_PATTERNS : CREDENTIAL_PATTERNS;
  for (const { label, pattern } of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) found.add(label);
  }
  for (const literal of usableLiterals(literals)) {
    if (text.includes(literal)) found.add("<api-key-value>");
  }
  return [...found];
}

/** Replace every credential in `text` with `[redacted]`. */
export function maskSecrets(text: string, literals: readonly (string | undefined)[] = []): string {
  let masked = text;
  for (const literal of usableLiterals(literals)) {
    masked = masked.split(literal).join("[redacted]");
  }
  for (const { pattern, maskable } of CREDENTIAL_PATTERNS) {
    if (maskable) masked = masked.replace(pattern, "[redacted]");
  }
  return masked;
}
