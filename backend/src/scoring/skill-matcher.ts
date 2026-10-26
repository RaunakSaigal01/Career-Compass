// 1️⃣  Path: backend/src/scoring/skill-matcher.ts
export const SKILL_ALIASES: Record<string, string[]> = {
  javascript: ['js', 'javascript', 'nodejs'],
  typescript: ['ts', 'typescript'],
  'node.js': ['node', 'nodejs', 'node.js'],
  postgresql: ['postgres', 'postgresql', 'pg'],
  mongodb: ['mongo', 'mongodb'],
  react: ['react', 'reactjs', 'react.js'],
  aws: ['amazon web services', 'aws'],
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function normalizeSkill(raw: string): string {
  const lower = raw.trim().toLowerCase();
  // direct match
  if (SKILL_ALIASES[lower]) return lower;
  // alias lookup
  for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
    if (aliases.includes(lower)) return canonical;
  }
  return lower;
}

// Returns a set of normalized skill strings found in the supplied text.
// Uses case‑insensitive regex with escaped terms.
export function extractSkillsFromText(text: string): Set<string> {
  const found = new Set<string>();
  const lowered = text.toLowerCase();
  for (const canonical of Object.keys(SKILL_ALIASES)) {
    const patterns = [canonical, ...(SKILL_ALIASES[canonical] ?? [])];
    for (const p of patterns) {
      const re = new RegExp(`\\b${escapeRegExp(p)}\\b`, 'i');
      if (re.test(lowered)) {
        found.add(canonical);
        break;
      }
    }
  }
  return found;
}