function normalizeForScopeCheck(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export type ScopeAttributes = Record<string, string[]>;

type ScopeAttributePair = {
  key: string;
  value: string;
};

const roleScopePrefixes = [
  'region',
  'canal',
  'segmento',
  'segment',
  'country',
  'pais',
  'category',
  'categoria',
  'linea',
  'line',
  'company',
  'empresa',
  'cliente',
  'customer',
];

function normalizeScopeKey(value: string): string | null {
  const normalized = normalizeForScopeCheck(value)
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || null;
}

function normalizeScopeValue(value: string): string | null {
  const normalized = normalizeForScopeCheck(value)
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || null;
}

function upsertScopeAttribute(target: ScopeAttributes, keyRaw: string, valueRaw: string): void {
  const key = normalizeScopeKey(keyRaw);
  const value = normalizeScopeValue(valueRaw);
  if (!key || !value) return;

  const current = target[key] ?? [];
  if (!current.includes(value)) {
    current.push(value);
    target[key] = current;
  }
}

function parseExplicitScopePair(token: string): ScopeAttributePair | null {
  const separatorIndex = token.search(/[:=]/);
  if (separatorIndex <= 0) return null;

  const key = token.slice(0, separatorIndex).trim();
  const value = token.slice(separatorIndex + 1).trim();
  if (!key || !value) return null;
  return { key, value };
}

function parsePrefixedScopePair(token: string): ScopeAttributePair | null {
  for (const prefix of roleScopePrefixes) {
    const underscorePrefix = `${prefix}_`;
    const hyphenPrefix = `${prefix}-`;

    if (token.startsWith(underscorePrefix) && token.length > underscorePrefix.length) {
      return { key: prefix, value: token.slice(underscorePrefix.length) };
    }

    if (token.startsWith(hyphenPrefix) && token.length > hyphenPrefix.length) {
      return { key: prefix, value: token.slice(hyphenPrefix.length) };
    }
  }

  return null;
}

export function hasScopeAttributes(attributes?: ScopeAttributes): boolean {
  if (!attributes) return false;
  return Object.values(attributes).some((values) => Array.isArray(values) && values.length > 0);
}

export function normalizeScopeAttributes(
  input?: Record<string, unknown> | null,
): ScopeAttributes {
  if (!input || typeof input !== 'object') return {};

  const output: ScopeAttributes = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
      upsertScopeAttribute(output, rawKey, String(value));
    }
  }

  return output;
}

function normalizeCompanyId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const normalized = String(Number(trimmed));
  if (normalized === '0' || normalized === 'NaN') return null;
  return normalized;
}

function uniquePush(target: string[], seen: Set<string>, value: string | null): void {
  if (!value || seen.has(value)) return;
  seen.add(value);
  target.push(value);
}

export function normalizeCompanyIds(ids?: string[]): string[] {
  if (!ids || ids.length === 0) return [];

  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    uniquePush(output, seen, normalizeCompanyId(raw));
  }
  return output;
}

export function extractCompanyIdsFromText(text: string): string[] {
  if (!text.trim()) return [];

  const normalized = normalizeForScopeCheck(text);
  const ids: string[] = [];
  const seen = new Set<string>();

  // Structured forms: companyId: 12, company_id=12, empresa-id #12
  const explicitRegex = /(?:company|empresa)(?:[_\s-]?id)?\s*[:=#-]\s*0*(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = explicitRegex.exec(normalized)) !== null) {
    uniquePush(ids, seen, normalizeCompanyId(match[1]));
  }

  // Natural language forms: empresa 12, compania numero 12, company 12
  const naturalRegex = /(?:empresa|compania|company)\s*(?:n(?:umero|ro)?\.?\s*)?0*(\d+)/g;
  while ((match = naturalRegex.exec(normalized)) !== null) {
    uniquePush(ids, seen, normalizeCompanyId(match[1]));
  }

  return ids;
}

export function extractCompanyIdsFromRoles(roles?: string[]): string[] {
  if (!roles || roles.length === 0) return [];

  const ids: string[] = [];
  const seen = new Set<string>();

  for (const role of roles) {
    const normalized = normalizeForScopeCheck(role);
    const regex = /(?:empresa|company)(?:[_\s-]?id)?[_\s:-]*0*(\d+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(normalized)) !== null) {
      uniquePush(ids, seen, normalizeCompanyId(match[1]));
    }
  }

  return ids;
}

export function extractScopeAttributesFromRoles(roles?: string[]): ScopeAttributes {
  if (!roles || roles.length === 0) return {};

  const attributes: ScopeAttributes = {};

  for (const role of roles) {
    const normalized = normalizeForScopeCheck(role);
    const tokens = normalized
      .split(/[|;,]/)
      .map((token) => token.trim())
      .filter(Boolean);

    for (const token of tokens) {
      const explicit = parseExplicitScopePair(token);
      if (explicit) {
        upsertScopeAttribute(attributes, explicit.key, explicit.value);
        continue;
      }

      const prefixed = parsePrefixedScopePair(token);
      if (prefixed) {
        upsertScopeAttribute(attributes, prefixed.key, prefixed.value);
      }
    }
  }

  for (const companyId of extractCompanyIdsFromRoles(roles)) {
    upsertScopeAttribute(attributes, 'company_id', companyId);
  }

  return attributes;
}

export function listDisallowedScopeAttributes(
  requestedScopeAttributes: ScopeAttributes,
  allowedScopeAttributes: ScopeAttributes,
): Array<{ key: string; value: string }> {
  const disallowed: Array<{ key: string; value: string }> = [];

  for (const [key, requestedValues] of Object.entries(requestedScopeAttributes)) {
    const allowedValues = new Set(allowedScopeAttributes[key] ?? []);
    for (const value of requestedValues) {
      if (!allowedValues.has(value)) {
        disallowed.push({ key, value });
      }
    }
  }

  return disallowed;
}

export function listDisallowedCompanyIds(referencedCompanyIds: string[], allowedCompanyIds: string[]): string[] {
  const allowed = new Set(allowedCompanyIds);
  return referencedCompanyIds.filter((companyId) => !allowed.has(companyId));
}
