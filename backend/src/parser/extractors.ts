const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/g;
const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const LINKEDIN_RE = /linkedin\.com\/[a-zA-Z0-9_/]+/i;
const GITHUB_RE = /github\.com\/[a-zA-Z0-9_/]+/i;

export interface BasicExtracted {
  emails: string[];
  phones: string[];
  urls: string[];
  linkedin?: string;
  github?: string;
}

export function extractBasics(text: string): BasicExtracted {
  const emails = Array.from(new Set(text.match(EMAIL_RE) ?? []));
  const phones = Array.from(
    new Set(
      (text.match(PHONE_RE) ?? []).filter(
        (p: string) => p.replace(/\D/g, '').length >= 10,
      ),
    ),
  );
  const urls = Array.from(new Set(text.match(URL_RE) ?? []));
  const linkedin = text.match(LINKEDIN_RE)?.[0];
  const github = text.match(GITHUB_RE)?.[0];

  return { emails, phones, urls, linkedin, github };
}

export interface SectionSplit {
  summary: string;
  education: string;
  experience: string;
  projects: string;
  skills: string;
  certifications: string;
  other: string;
}

const SECTION_HEADINGS: Record<keyof Omit<SectionSplit, 'other'>, RegExp> = {
  summary:
    /^(?:summary|executive summary|professional summary|professional profile|career summary|objective|career objective|profile|about me|about)\s*[:-]?\s*$/i,
  education:
    /^(?:education|education and training|education & training|academic background|qualifications|academic history)\s*[:-]?\s*$/i,
  experience:
    /^(?:work history|work experience|professional experience|experience|employment history|career history|internships?)\s*[:-]?\s*$/i,
  projects:
    /^(?:projects|key projects|academic projects|personal projects|notable projects|technical projects)\s*[:-]?\s*$/i,
  skills:
    /^(?:technical skills|skills|technologies|tools|competencies|skill set|core competencies|areas of expertise)\s*[:-]?\s*$/i,
  certifications:
    /^(?:certifications|certificates|licenses & certifications|licenses and certifications|licenses|achievements|courses|credentials)\s*[:-]?\s*$/i,
};

export function splitSections(text: string): SectionSplit {
  const lines = text.split(/\r?\n/);
  const indices: Array<{
    key: keyof Omit<SectionSplit, 'other'>;
    line: number;
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    for (const [key, re] of Object.entries(SECTION_HEADINGS) as [
      keyof Omit<SectionSplit, 'other'>,
      RegExp,
    ][]) {
      if (re.test(line)) {
        indices.push({ key, line: i });
      }
    }
  }

  indices.sort((a, b) => a.line - b.line);

  const result: SectionSplit = {
    summary: '',
    education: '',
    experience: '',
    projects: '',
    skills: '',
    certifications: '',
    other: '',
  };

  if (indices.length === 0) {
    result.other = text;
    return result;
  }

  result.other = lines.slice(0, indices[0].line).join('\n').trim();

  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].line + 1;
    const end = i + 1 < indices.length ? indices[i + 1].line : lines.length;
    result[indices[i].key] = lines.slice(start, end).join('\n').trim();
  }

  return result;
}

export function extractSkills(
  text: string,
  dictionary: readonly string[],
): string[] {
  const found = new Set<string>();
  const sorted = [...dictionary].sort((a, b) => b.length - a.length);
  const lower = text.toLowerCase();

  for (const skill of sorted) {
    const needle = skill.toLowerCase();
    // Use boundaries that respect +, # symbols (e.g. C, C++, C#, .NET)
    const re = new RegExp(
      `(^|[^a-z0-9+#])${escapeRegExp(needle)}([^a-z0-9+#]|$)`,
      'i',
    );
    if (re.test(lower)) {
      found.add(skill);
    }
  }

  return [...found];
}

/**
 * Dynamically parses items declared in a dedicated Technical Skills section.
 * Filters out category prefixes, parenthetical noise, pagination footers (e.g. "-- 1 of 1 --"),
 * and non-skill artifacts.
 */
export function extractSkillsFromSection(
  sectionText: string,
  dictionary: readonly string[] = [],
): string[] {
  if (!sectionText || !sectionText.trim()) return [];

  // Strip page numbering artifacts (e.g., "Page 1 of 1", "-- 1 of 1 --", "1 of 2")
  let sanitizedText = sectionText
    .replace(/(?:page\s*\d+\s*(?:of|\/)\s*\d+|[-–—]+\s*\d+\s*(?:of|\/)\s*\d+\s*[-–—]+|\b\d+\s*of\s*\d+\b)/gi, '')
    .replace(/[-–—]{2,}/g, ' ');

  const dictMap = new Map<string, string>();
  for (const item of dictionary) {
    dictMap.set(item.toLowerCase(), item);
  }

  const rawTokens = new Set<string>();
  const lines = sanitizedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const noiseKeywords = new Set([
    'languages',
    'frameworks',
    'developer tools',
    'tools',
    'technologies',
    'skills',
    'technical skills',
    'core competencies',
    'platforms',
    'libraries',
    'databases',
    'operating systems',
    'hardware',
    'software',
    'other',
    'and',
    'or',
    'etc',
    'page',
  ]);

  for (const line of lines) {
    // Ignore footer/header noise lines
    if (/^(page\s*\d+|[-–—\s\d/]+of\s*\d+[-–—\s\d/]*)$/i.test(line)) {
      continue;
    }

    // Check for category prefix like "Category Name: items"
    let content = line;
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && colonIdx < 40) {
      content = line.slice(colonIdx + 1);
    }

    // Strip leading bullet symbols
    content = content.replace(/^[\s•\-*→▪\d.)]+/, '').trim();

    // Extract sub-parentheses as separate candidate tokens, e.g. "Cadence Virtuoso (Schematic, ADE-L)"
    const parenthesized = content.match(/\(([^)]+)\)/g) || [];
    for (const p of parenthesized) {
      const inner = p.slice(1, -1);
      const innerItems = inner.split(/[,;/|•]/);
      for (const item of innerItems) {
        const clean = cleanToken(item);
        if (isValidSkillToken(clean, noiseKeywords)) {
          rawTokens.add(clean);
        }
      }
    }

    // Clean parentheses from main content for item splitting
    const cleanContent = content.replace(/\([^)]*\)/g, ' ');

    // Split by comma, pipe, semicolon, bullet, or slash
    const items = cleanContent.split(/[,;|•]/);
    for (let item of items) {
      const subItems = item.includes('/') ? item.split('/') : [item];
      for (const sub of subItems) {
        const clean = cleanToken(sub);
        if (isValidSkillToken(clean, noiseKeywords)) {
          rawTokens.add(clean);
        }
      }
    }
  }

  // Normalize and filter
  const finalSkills = new Set<string>();

  for (const token of rawTokens) {
    const lower = token.toLowerCase();
    if (noiseKeywords.has(lower)) continue;

    // If matches dictionary, use exact dictionary casing
    if (dictMap.has(lower)) {
      finalSkills.add(dictMap.get(lower)!);
    } else {
      finalSkills.add(token);
    }
  }

  return Array.from(finalSkills);
}

function cleanToken(token: string): string {
  return token
    .replace(/^['"`\s•\-–—.,;:/\\]+|['"`\s•\-–—.,;:/\\]+$/g, '')
    .trim();
}

function isValidSkillToken(token: string, noiseSet: Set<string>): boolean {
  if (!token || token.length < 1 || token.length > 35) return false;
  // Must contain at least one letter or be C/C++/C#
  if (!/[a-zA-Z]/.test(token)) return false;
  // Reject pagination tokens like "of 1", "page 1", "1 of 1"
  if (/^(?:of\s*\d+|\d+\s*of\s*\d+|page\s*\d+)$/i.test(token)) return false;
  if (noiseSet.has(token.toLowerCase())) return false;
  return true;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
