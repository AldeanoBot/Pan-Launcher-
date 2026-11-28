export type LauncherLang = 'es' | 'en';

export function normalizeLanguage(raw: unknown): LauncherLang {
  const s = String(raw || '').trim().toLowerCase();
  return s === 'en' || s.startsWith('en-') || s.startsWith('en_') ? 'en' : 'es';
}

export function formatTemplate(
  template: string,
  vars?: Record<string, string | number | null | undefined>
): string {
  const base = String(template || '');
  if (!vars) return base;
  return base.replace(/\{([A-Za-z0-9_]+)\}/g, (full, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return full;
    const val = vars[key];
    return val === undefined || val === null ? '' : String(val);
  });
}

export function findMissingDictKeys(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>
): string[] {
  const missing: string[] = [];
  for (const key of Object.keys(primary)) {
    if (!Object.prototype.hasOwnProperty.call(secondary, key)) {
      missing.push(key);
    }
  }
  return missing;
}
