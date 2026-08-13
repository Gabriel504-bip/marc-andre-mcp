/**
 * Compaction des réponses volumineuses avant de les rendre à Claude.
 * Règle : toute troncature est ANNONCÉE explicitement, jamais muette
 * (voir §3.1 du rapport — `raw`, `doublonStats.tablesTronquees`, etc.).
 */

export function stripRawFields<T extends Record<string, unknown>>(
  items: T[]
): Omit<T, 'raw'>[] {
  return items.map(({ raw, ...rest }: any) => rest);
}

export function truncateList<T>(
  items: T[],
  max: number
): { items: T[]; truncated: boolean; totalAvant: number } {
  if (items.length <= max) {
    return { items, truncated: false, totalAvant: items.length };
  }
  return { items: items.slice(0, max), truncated: true, totalAvant: items.length };
}

/**
 * Élagage par sections pour ma_fiche_client : la route sous-jacente
 * renvoie TOUT (hubspot, quickbooks, docusign, threads, mandats, jobs,
 * depots, registres) ; le paramètre `sections` n'existe pas côté route,
 * c'est un filtrage fait ICI, côté passerelle.
 */
export function pickSections<T extends Record<string, unknown>>(
  full: T,
  sections: string[] | undefined,
  sectionKeyMap: Record<string, string[]>
): Partial<T> {
  if (!sections || sections.length === 0) return full;
  const keysToKeep = new Set<string>();
  for (const s of sections) {
    for (const k of sectionKeyMap[s] ?? []) keysToKeep.add(k);
  }
  const out: Partial<T> = {};
  for (const key of Object.keys(full)) {
    if (keysToKeep.has(key)) (out as any)[key] = (full as any)[key];
  }
  return out;
}
