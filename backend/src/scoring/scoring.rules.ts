import { ScoreCategory } from './schemas/resume-analysis.schema';

export interface ScoreInput {
  rawText: string;
  skills: string[];
  basics: {
    emails: string[];
    phones: string[];
    linkedin?: string;
    github?: string;
  };
  sections: {
    summary: string;
    education: string;
    experience: string;
    projects: string;
    skills: string;
    certifications: string;
  };
  jobKeywords: string[];
}

export interface ScoreRule {
  id: string;
  category: ScoreCategory;
  maxPoints: number;
  evaluate: (input: ScoreInput) => number;
  reasonWhenLost: (input: ScoreInput) => string;
  action: string;
}
export const SCORE_RULES: ScoreRule[] = [
  // ---------- Parsing and formatting (20) ----------
  {
    id: 'email.present',
    category: 'Parsing and formatting',
    maxPoints: 2,
    evaluate: (i) => (i.basics.emails.length > 0 ? 2 : 0),
    reasonWhenLost: () => 'No email address was found in your resume.',
    action: 'Add a professional email address near your name at the top.',
  },
  {
    id: 'phone.present',
    category: 'Parsing and formatting',
    maxPoints: 2,
    evaluate: (i) => (i.basics.phones.length > 0 ? 2 : 0),
    reasonWhenLost: () => 'No phone number was found.',
    action: 'Add a reachable phone number, including country code.',
  },
  {
    id: 'linkedin.present',
    category: 'Parsing and formatting',
    maxPoints: 1,
    evaluate: (i) => (i.basics.linkedin ? 1 : 0),
    reasonWhenLost: () => 'No LinkedIn profile URL was found.',
    action: 'Add the full LinkedIn URL (linkedin.com/in/your-handle).',
  },
  {
    id: 'github.present',
    category: 'Parsing and formatting',
    maxPoints: 1,
    evaluate: (i) => (i.basics.github ? 1 : 0),
    reasonWhenLost: () => 'No GitHub profile URL was found.',
    action: 'If you write code, add a link to your GitHub profile.',
  },
  {
    id: 'name.present',
    category: 'Parsing and formatting',
    maxPoints: 2,
    evaluate: (i) =>
      /^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,3}$/m.test(i.rawText) ? 2 : 0,
    reasonWhenLost: () =>
      'No recognisable candidate name was found at the top.',
    action: 'Put your full name as the very first line of the resume.',
  },
    {
    id: 'tables.detected',
    category: 'Parsing and formatting',
    maxPoints: 4,
    evaluate: (i) => (/(│|┌|─|└|┘|├|┤|┬|┴|┼)/.test(i.rawText) ? 0 : 4),
    reasonWhenLost: () => 'Tables or column-like characters were detected.',
    action:
      'Convert tables to single-column bullet lists — many ATS parsers break on tables.',
  },
  {
    id: 'columns.detected',
    category: 'Parsing and formatting',
    maxPoints: 3,
    evaluate: (i) => {
      const lines = i.rawText.split(/\r?\n/);
      const suspicious = lines.filter((l) => {
        const trimmed = l.trim();
        return (
          trimmed.length > 0 &&
          trimmed.length < 50 &&
          /\S+\s{2,}\S+\s{2,}\S+/.test(trimmed)
        );
      }).length;
      return suspicious >= 3 ? 0 : 3;
    },
    reasonWhenLost: () => 'The text layout suggests a two-column design.',
    action:
      'Use a single-column layout — two-column resumes confuse ATS parsers.',
  },
    {
    id: 'contact.line.complete',
    category: 'Parsing and formatting',
    maxPoints: 5,
    evaluate: (i) => {
      let pts = 0;
      if (i.basics.emails.length > 0 && i.basics.phones.length > 0) pts += 2;
      if (i.basics.linkedin) pts += 2;
      if (i.basics.github) pts += 1;
      return pts;
    },
    reasonWhenLost: (i) => {
      const missing: string[] = [];
      if (!(i.basics.emails.length > 0 && i.basics.phones.length > 0)) missing.push('email + phone together');
      if (!i.basics.linkedin) missing.push('LinkedIn URL');
      if (!i.basics.github) missing.push('GitHub URL');
      return `Missing contact details: ${missing.join(', ')}.`;
    },
    action: 'Include email, phone, LinkedIn, and GitHub (if applicable) in your header for a complete contact line.',
  },

  // ---------- Required sections (15) ----------
  {
    id: 'sections.summary',
    category: 'Required sections',
    maxPoints: 2,
    evaluate: (i) => (i.sections.summary.trim().length > 20 ? 2 : 0),
    reasonWhenLost: () => 'No summary or objective section was detected.',
    action:
      'Add a 2–4 line summary at the top describing who you are and what you want.',
  },
  {
    id: 'sections.experience',
    category: 'Required sections',
    maxPoints: 4,
    evaluate: (i) => (i.sections.experience.trim().length > 20 ? 4 : 0),
    reasonWhenLost: () => 'No experience section was detected.',
    action:
      'Add a Work Experience section with role, company, dates, and bullet points.',
  },
  {
    id: 'sections.education',
    category: 'Required sections',
    maxPoints: 3,
    evaluate: (i) => (i.sections.education.trim().length > 10 ? 3 : 0),
    reasonWhenLost: () => 'No education section was detected.',
    action: 'Add an Education section with degree, institution, and year.',
  },
  {
    id: 'sections.skills',
    category: 'Required sections',
    maxPoints: 3,
    evaluate: (i) => (i.sections.skills.trim().length > 10 ? 3 : 0),
    reasonWhenLost: () => 'No skills section was detected.',
    action: 'Add a Skills section listing your technologies and tools.',
  },
  {
    id: 'sections.projects',
    category: 'Required sections',
    maxPoints: 2,
    evaluate: (i) => (i.sections.projects.trim().length > 10 ? 2 : 0),
    reasonWhenLost: () => 'No projects section was detected.',
    action: 'Add 1–3 projects showing what you have built, with your role.',
  },
  {
    id: 'sections.certifications',
    category: 'Required sections',
    maxPoints: 1,
    evaluate: (i) => (i.sections.certifications.trim().length > 5 ? 1 : 0),
    reasonWhenLost: () => 'No certifications section was detected.',
    action:
      'List relevant certifications, licences, or awards if you have them.',
  },

  // ---------- Skills and keywords (25) ----------
  {
    id: 'skills.count',
    category: 'Skills and keywords',
    maxPoints: 12,
    evaluate: (i) => {
      const n = i.skills.length;
      if (n >= 12) return 12;
      if (n >= 8) return 9;
      if (n >= 5) return 6;
      if (n >= 3) return 3;
      return 0;
    },
    reasonWhenLost: (i) =>
      `Only ${i.skills.length} known skills were detected (12+ is ideal).`,
    action:
      'Add more relevant skills. Only list what you can speak to in an interview.',
  },
  {
    id: 'skills.jobAlignment',
    category: 'Skills and keywords',
    maxPoints: 13,
    evaluate: (i) => {
      if (i.jobKeywords.length === 0) return 0;
      const resumeSet = new Set(i.skills.map((s) => s.toLowerCase()));
      const matched = i.jobKeywords.filter((k) =>
        resumeSet.has(k.toLowerCase()),
      ).length;
      const ratio = matched / i.jobKeywords.length;
      return Math.round(ratio * 13);
    },
    reasonWhenLost: (i) =>
      i.jobKeywords.length === 0
        ? 'No job description was provided.'
        : `Only ${i.jobKeywords.length === 0 ? 0 : 'a few'} of the job description’s keywords appear on your resume.`,
    action:
      'Tailor your skills section to the target job description where truthful.',
  },

  // ---------- Experience quality (15) ----------
  {
    id: 'exp.bulletCount',
    category: 'Experience quality',
    maxPoints: 4,
    evaluate: (i) => {
      const bullets = (i.sections.experience.match(/\n\s*[•\-*�▪]/g) ?? [])
        .length;
      if (bullets >= 8) return 4;
      if (bullets >= 5) return 3;
      if (bullets >= 3) return 2;
      return bullets > 0 ? 1 : 0;
    },
    reasonWhenLost: (i) => {
      const bullets = (i.sections.experience.match(/\n\s*[•\-*▸▪]/g) ?? [])
        .length;
      return `Only ${bullets} experience bullet points were detected (8+ is ideal).`;
    },
    action:
      'Add more bullet points — one per responsibility or achievement per role.',
  },
  {
    id: 'exp.actionVerbs',
    category: 'Experience quality',
    maxPoints: 4,
    evaluate: (i) => {
      const verbs = [
        'built',
        'designed',
        'developed',
        'implemented',
        'led',
        'owned',
        'launched',
        'shipped',
        'migrated',
        'reduced',
        'increased',
        'improved',
        'automated',
        'optimised',
        'optimized',
        'refactored',
        'mentored',
        'collaborated',
        'delivered',
        'architected',
      ];
      const lower = i.rawText.toLowerCase();
      const count = verbs.filter((v) =>
        new RegExp(`\\b${v}\\b`).test(lower),
      ).length;
      if (count >= 8) return 4;
      if (count >= 5) return 3;
      if (count >= 3) return 2;
      return count > 0 ? 1 : 0;
    },
    reasonWhenLost: () => 'Few strong action verbs were detected.',
    action:
      'Start each bullet with a strong verb (Built, Led, Improved, Automated, …).',
  },
  {
    id: 'exp.quantified',
    category: 'Experience quality',
    maxPoints: 4,
    evaluate: (i) => {
      const text = i.sections.experience;
      const matches =
        text.match(
          /\b\d+([.,]\d+)?\s*(%|x|users?|ms|s|sec|min|hours?|days?|weeks?|months?|years?|k|m|bn|cr|lakh|lakhs|₹|\$|€|£)?/gi,
        ) ?? [];
      const unique = new Set(
        matches.map((match: string) => match.toLowerCase().trim()),
      );
      if (unique.size >= 4) return 4;
      if (unique.size >= 2) return 3;
      if (unique.size >= 1) return 1;
      return 0;
    },
    reasonWhenLost: (i) => {
      const text = i.sections.experience;
      const matches =
        text.match(
          /\b\d+([.,]\d+)?\s*(%|x|users?|ms|s|sec|min|hours?|days?|weeks?|months?|years?|k|m|bn|cr|lakh|lakhs|₹|\$|€|£)?/gi,
        ) ?? [];
      const unique = new Set(
        matches.map((match: string) => match.toLowerCase().trim()),
      );
      return `Only ${unique.size} measurable figure(s) were found in your experience bullets.`;
    },
    action:
      'Add truthful numbers: time saved, users served, % improvement, revenue impact, latency reduction.',
  },
    {
    id: 'exp.weakPhrases',
    category: 'Experience quality',
    maxPoints: 3,
    evaluate: (i) => {
      const weak = [
        'worked on',
        'responsible for',
        'helped with',
        'involved in',
        'was part of',
        'tasked with',
      ];
      const lower = i.rawText.toLowerCase();
      const hits = weak.filter((w) => lower.includes(w)).length;
      if (hits === 0) return 3;
      if (hits <= 2) return 1;
      return 0;
    },
    reasonWhenLost: (i) => {
      const weak = [
        'worked on',
        'responsible for',
        'helped with',
        'involved in',
        'was part of',
        'tasked with',
      ];
      const lower = i.rawText.toLowerCase();
      const hits = weak.filter((w) => lower.includes(w));
      return `Weak phrases detected: ${hits.join(', ')}.`;
    },
    action: 'Replace vague phrases with strong verbs and concrete outcomes.',
  },

  // ---------- Content quality (10) ----------
  {
    id: 'content.length',
    category: 'Content quality',
    maxPoints: 5,
    evaluate: (i) => {
      const words = i.rawText.split(/\s+/).filter(Boolean).length;
      if (words >= 350 && words <= 900) return 5;
      if (words >= 200 && words <= 1100) return 3;
      return 1;
    },
    reasonWhenLost: (i) => {
      const words = i.rawText.split(/\s+/).filter(Boolean).length;
      return `Resume is ${words} words long — aim for 350–900 words.`;
    },
    action: 'Aim for 350–900 words: enough detail, no fluff.',
  },
    {
    id: 'content.repetition',
    category: 'Content quality',
    maxPoints: 5,
    evaluate: (i) => {
      const lines = i.rawText
        .split(/\r?\n/)
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean);
      const counts = new Map<string, number>();
      for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
      const repeated = [...counts.values()].filter((c) => c >= 3).length;
      if (repeated === 0) return 5;
      if (repeated <= 2) return 2;
      return 0;
    },
    reasonWhenLost: () => 'The same line or phrase appears multiple times.',
    action:
      'Remove duplicated lines — they signal sloppy editing or copy-paste errors.',
  },

  // ---------- ATS compatibility (10) ----------
    {
    id: 'ats.noImages',
    category: 'ATS compatibility',
    maxPoints: 4,
    evaluate: (i) => {
      const imgHints = (i.rawText.match(/\.(png|jpg|jpeg|gif|svg)/gi) ?? [])
        .length;
      return imgHints > 2 ? 0 : 4;
    },
    reasonWhenLost: () => 'Several image references were detected in the file.',
    action: 'Avoid embedding logos or images — ATS parsers cannot read them.',
  },
      {
    id: 'ats.noHeadersFooters',
    category: 'ATS compatibility',
    maxPoints: 3,
    evaluate: (i) => {
      const first = i.rawText
        .split(/\r?\n/)
        .slice(0, 2)
        .join(' ')
        .toLowerCase();
      const last = i.rawText.split(/\r?\n/).slice(-2).join(' ').toLowerCase();
      let pts = 3;
      if (/page\s*\d+\s*of\s*\d+/i.test(last)) pts -= 2;
      if (/^confidential\b|^resume\b/i.test(first)) pts -= 1;
      return Math.max(0, pts);
    },
    reasonWhenLost: () => 'Resume uses page numbers or generic header text.',
    action:
      'Drop page numbers and words like "Resume" or "Confidential" in headers/footers.',
  },
    {
    id: 'ats.plainLanguage',
    category: 'ATS compatibility',
    maxPoints: 3,
    evaluate: (i) => {
      const weirdChars = (i.rawText.match(/[''""–—…]/g) ?? []).length;
      return weirdChars > 8 ? 0 : 3;
    },
    reasonWhenLost: () =>
      'Many special typographic characters (curly quotes, em dashes, …) were detected.',
    action:
      'Use plain ASCII characters — straight quotes, hyphens, and ellipses.',
  },

  // ---------- Target-job alignment (5) ----------
  {
    id: 'job.tailored',
    category: 'Target-job alignment',
    maxPoints: 5,
    evaluate: (i) => {
      if (i.jobKeywords.length === 0) return 0;
      const lower = i.rawText.toLowerCase();
      const matched = i.jobKeywords.filter((k) =>
        lower.includes(k.toLowerCase()),
      ).length;
      const ratio = matched / i.jobKeywords.length;
      if (ratio >= 0.7) return 5;
      if (ratio >= 0.5) return 4;
      if (ratio >= 0.3) return 2;
      return matched > 0 ? 1 : 0;
    },
    reasonWhenLost: (i) =>
      i.jobKeywords.length === 0
        ? 'No job description was provided for tailoring.'
        : 'Few of the job description’s keywords appear in your resume text.',
    action:
      'Mirror the job description’s keywords where your experience genuinely matches.',
  },
];

export const CATEGORY_MAX: Record<ScoreCategory, number> = {
  'Parsing and formatting': 20,
  'Required sections': 15,
  'Skills and keywords': 25,
  'Experience quality': 15,
  'Content quality': 10,
  'ATS compatibility': 10,
  'Target-job alignment': 5,
};
