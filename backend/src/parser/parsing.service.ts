import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import * as path from 'path';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { GoogleGenAI, Type } from '@google/genai';
import {
  extractBasics,
  extractSkills,
  extractSkillsFromSection,
  splitSections,
  BasicExtracted,
  SectionSplit,
} from './extractors';
import { SKILLS_DICTIONARY } from './skills-dictionary';

export interface ParsedProfile {
  name?: string;
  basics: BasicExtracted;
  sections: SectionSplit;
  skills: string[];
  rawText: string;
}

interface ResumeModelEntity {
  text: string;
  label: string;
  start: number;
  end: number;
}

interface ResumeModelResponse {
  entities?: ResumeModelEntity[];
  structured?: {
    full_name?: string;
    email?: string;
    phone?: string;
    linkedin?: string;
    github?: string;
    skills?: string[];
    summary?: string;
    experience?: string[];
    education?: string[];
    projects?: string[];
    certifications?: string[];
  };
}

@Injectable()
export class ParsingService {
  private readonly logger = new Logger(ParsingService.name);
  private genAI: GoogleGenAI | null = null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenAI({ apiKey });
    }
  }

  async extractText(filePath: string, mimeType: string): Promise<string> {
    const buffer = await fs.readFile(filePath);

    if (mimeType === 'application/pdf') {
      const parser = new PDFParse({ data: buffer });
      let text = '';
      try {
        const result = await parser.getText();
        text = result.text ?? '';
      } finally {
        await parser.destroy();
      }

      // If text is suspiciously short or empty (e.g. scanned/image PDF), use RapidOCR
      const cleanLen = text.replace(/[\s\-_0-9of]/gi, '').length;
      if (cleanLen < 60) {
        this.logger.log(`PDF has little embedded text (${cleanLen} chars). Falling back to RapidOCR...`);
        const ocrText = await this.extractTextWithOCR(filePath);
        if (ocrText && ocrText.trim().length > text.trim().length) {
          return ocrText;
        }
      }

      return text;
    }

    if (
      mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value ?? '';
    }

    return '';
  }

  private async extractTextWithOCR(filePath: string): Promise<string> {
    const serviceUrl = process.env.RESUME_ML_URL?.trim();
    if (serviceUrl) {
      try {
        const res = await fetch(`${serviceUrl.replace(/\/$/, '')}/ocr-pdf`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file_path: filePath }),
        });
        if (res.ok) {
          const payload = (await res.json()) as { text?: string };
          if (payload.text && payload.text.trim().length > 50) {
            this.logger.log(`OCR succeeded via ML service (${payload.text.length} chars)`);
            return payload.text.trim();
          }
        }
      } catch (e) {
        this.logger.warn(`OCR via service failed, trying direct python fallback: ${e.message}`);
      }
    }

    return new Promise<string>((resolve) => {
      const pythonExe = path.resolve(process.cwd(), 'resume-ml/.venv/Scripts/python.exe');
      const scriptPath = path.resolve(process.cwd(), 'resume-ml/scripts/ocr_pdf.py');
      execFile(pythonExe, [scriptPath, filePath], { maxBuffer: 15 * 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout) {
          this.logger.warn(`OCR script failed: ${err?.message || 'Empty stdout'}`);
          return resolve('');
        }
        this.logger.log(`OCR succeeded via direct script (${stdout.length} chars)`);
        resolve(stdout.trim());
      });
    });
  }

  /**
   * Fast, resilient profile parsing:
   * 1. Extracts base sections & skills locally instantly (<30ms).
   * 2. Calls gemini-3.5-flash-lite (~1.6s) to enrich and extract full vocabulary.
   * 3. Merges results with automatic fallback.
   */
  async parseProfile(text: string): Promise<ParsedProfile> {
    let baseProfile = this.parseProfileDeterministic(text);

    // Opt in only after the local model has been trained and validated. The
    // model endpoint is private/local and never receives a resume by default.
    const modelUrl = process.env.RESUME_ML_URL?.trim();
    const modelIsPrimary = process.env.RESUME_ML_PRIMARY === 'true';
    if (modelUrl && modelIsPrimary) {
      const modelProfile = await this.parseProfileWithLocalModel(text, modelUrl);
      if (modelProfile) {
        baseProfile = this.mergeProfiles(modelProfile, baseProfile, text);
        // A validated local model avoids external inference latency/cost.
        return baseProfile;
      }
    }

    if (!this.genAI && process.env.GEMINI_API_KEY) {
      this.genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }

    if (this.genAI) {
      try {
        // Enforce a 7000ms timeout for reliable AI extraction without blocking
        const llmPromise = this.parseProfileWithLLM(text);
        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('LLM timeout (7000ms exceeded)')), 7000),
        );

        const aiProfile = await Promise.race([llmPromise, timeoutPromise]);
        if (aiProfile) {
          const mergedSkills = Array.from(
            new Set([...(aiProfile.skills || []), ...(baseProfile.skills || [])]),
          );
          return {
            name: aiProfile.name || baseProfile.name,
            basics: {
              emails: Array.from(
                new Set([
                  ...(aiProfile.basics?.emails || []),
                  ...(baseProfile.basics?.emails || []),
                ]),
              ),
              phones: Array.from(
                new Set([
                  ...(aiProfile.basics?.phones || []),
                  ...(baseProfile.basics?.phones || []),
                ]),
              ),
              urls: Array.from(
                new Set([
                  ...(aiProfile.basics?.urls || []),
                  ...(baseProfile.basics?.urls || []),
                ]),
              ),
              linkedin: aiProfile.basics?.linkedin || baseProfile.basics?.linkedin,
              github: aiProfile.basics?.github || baseProfile.basics?.github,
            },
            sections: baseProfile.sections,
            skills: mergedSkills,
            rawText: text,
          };
        }
      } catch (error) {
        this.logger.warn(
          `AI parsing skipped (${error.message}). Used high-speed local engine.`,
        );
      }
    }

    return baseProfile;
  }

  private async parseProfileWithLocalModel(
    text: string,
    serviceUrl: string,
  ): Promise<ParsedProfile | null> {
    const timeoutMs = Number(process.env.RESUME_ML_TIMEOUT_MS || 2500);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(`Local resume model returned HTTP ${response.status}.`);
        return null;
      }
      const payload = (await response.json()) as ResumeModelResponse;
      if (!Array.isArray(payload.entities)) return null;

      const entities = payload.entities.filter(
        (entity) =>
          typeof entity?.text === 'string' &&
          typeof entity?.label === 'string' &&
          Number.isInteger(entity.start) &&
          Number.isInteger(entity.end),
      );
      if (entities.length === 0) return null;
      const values = (label: string) =>
        entities
          .filter((entity) => entity.label.toUpperCase() === label)
          .map((entity) => entity.text.trim())
          .filter(Boolean);
      const people = entities
        .filter(
          (entity) =>
            entity.label.toUpperCase() === 'PERSON' && entity.start < 500,
        )
        .sort((left, right) => left.start - right.start);
      const localBasics = extractBasics(text);
      const sections = splitSections(text);
      if (payload.structured) {
        if (!sections.summary && payload.structured.summary) {
          sections.summary = payload.structured.summary;
        }
        if (!sections.experience && payload.structured.experience?.length) {
          sections.experience = payload.structured.experience.join('\n');
        }
        if (!sections.education && payload.structured.education?.length) {
          sections.education = payload.structured.education.join('\n');
        }
        if (!sections.projects && payload.structured.projects?.length) {
          sections.projects = payload.structured.projects.join('\n');
        }
        if (!sections.certifications && payload.structured.certifications?.length) {
          sections.certifications = payload.structured.certifications.join('\n');
        }
      }

      const structuredSkills = payload.structured?.skills || [];
      const skills = Array.from(
        new Map(
          [...values('SKILL'), ...structuredSkills, ...extractSkills(text, SKILLS_DICTIONARY)].map(
            (skill) => [skill.toLowerCase(), skill],
          ),
        ).values(),
      );

      const candidateName = people[0]?.text.trim() || payload.structured?.full_name?.trim() || undefined;
      const structuredEmail = payload.structured?.email ? [payload.structured.email] : [];
      const structuredPhone = payload.structured?.phone ? [payload.structured.phone] : [];
      const structuredLinkedin = payload.structured?.linkedin || localBasics.linkedin;
      const structuredGithub = payload.structured?.github || localBasics.github;

      return {
        name: candidateName,
        basics: {
          emails: Array.from(new Set([...values('EMAIL'), ...structuredEmail, ...localBasics.emails])),
          phones: Array.from(new Set([...values('PHONE'), ...structuredPhone, ...localBasics.phones])),
          urls: Array.from(new Set([...values('URL'), ...localBasics.urls])),
          linkedin: structuredLinkedin,
          github: structuredGithub,
        },
        sections,
        skills,
        rawText: text,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown error';
      this.logger.warn(`Local resume model unavailable (${reason}).`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private mergeProfiles(
    preferred: ParsedProfile,
    fallback: ParsedProfile,
    text: string,
  ): ParsedProfile {
    return {
      name: preferred.name || fallback.name,
      basics: {
        emails: Array.from(new Set([...preferred.basics.emails, ...fallback.basics.emails])),
        phones: Array.from(new Set([...preferred.basics.phones, ...fallback.basics.phones])),
        urls: Array.from(new Set([...preferred.basics.urls, ...fallback.basics.urls])),
        linkedin: preferred.basics.linkedin || fallback.basics.linkedin,
        github: preferred.basics.github || fallback.basics.github,
      },
      sections: fallback.sections,
      skills: Array.from(
        new Map(
          [...preferred.skills, ...fallback.skills].map((skill) => [skill.toLowerCase(), skill]),
        ).values(),
      ),
      rawText: text,
    };
  }

  /**
   * Ultra-fast Gemini structured extraction using gemini-3.5-flash-lite.
   */
  private async parseProfileWithLLM(text: string): Promise<ParsedProfile> {
    const cleanSample = text.length > 5000 ? text.slice(0, 5000) : text;

    const response = await this.genAI!.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: `Extract the full candidate name, contact URLs/socials, and all technical skills, programming languages, and tools from this resume:\n"""\n${cleanSample}\n"""`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "Candidate's full name" },
            emails: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            phones: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            linkedin: {
              type: Type.STRING,
            },
            github: {
              type: Type.STRING,
            },
            urls: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            skills: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'All technical tools, languages, and skills.',
            },
          },
          required: ['name', 'skills'],
        },
        maxOutputTokens: 2048,
        temperature: 0,
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    const sections = splitSections(text);

    return {
      name: parsed.name || undefined,
      basics: {
        emails: parsed.emails || [],
        phones: parsed.phones || [],
        urls: parsed.urls || [],
        linkedin: parsed.linkedin || undefined,
        github: parsed.github || undefined,
      },
      sections,
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      rawText: text,
    };
  }

  /**
   * Instant deterministic parser using Regex + Section Tokenizer (~30ms)
   */
  parseProfileDeterministic(text: string): ParsedProfile {
    const basics = extractBasics(text);
    const sections = splitSections(text);

    const dictSkills = extractSkills(text, SKILLS_DICTIONARY);
    const sectionSkills = extractSkillsFromSection(
      sections.skills,
      SKILLS_DICTIONARY,
    );

    const merged = new Map<string, string>();
    for (const s of [...sectionSkills, ...dictSkills]) {
      const clean = s.trim();
      if (!clean) continue;
      const lower = clean.toLowerCase();
      if (!merged.has(lower)) {
        merged.set(lower, clean);
      }
    }

    const headerLines = sections.other
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    return {
      name: headerLines[0],
      basics,
      sections,
      skills: Array.from(merged.values()),
      rawText: text,
    };
  }
}
