// 1️⃣  Path: backend/src/scoring/recommendation.service.ts
import { Injectable } from '@nestjs/common';
import {
  Recommendation,
  RecommendationCategory,
} from './schemas/resume-analysis.schema';
import { normalizeSkill, extractSkillsFromText } from './skill-matcher';

type RecommendationInput = {
  rawText: string;
  skills: string[];
  basics: { emails: string[]; phones: string[]; linkedin?: string; github?: string };
  sections: {
    summary: string;
    education: string;
    experience: string;
    projects: string;
    skills: string;
    certifications: string;
  };
  jobKeywords?: string[];
};

@Injectable()
export class RecommendationService {
  /** Main entry point – deterministic recommendation generation */
  generate(input: RecommendationInput, jobDescription?: string): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // ---- General (no job description) ----
    if (!jobDescription) {
      this.applyGeneralRules(input, recommendations);
    }

    // ---- Job‑specific rules ----
    if (jobDescription) {
      const jobSkills = extractSkillsFromText(jobDescription);
      const resumeSkills = new Set(input.skills.map(normalizeSkill));

      // Missing required job skills
      for (const skill of jobSkills) {
        if (!resumeSkills.has(skill)) {
          recommendations.push({
            id: `missing_skill_${skill}`,
            category: 'Skills and keywords',
            priority: 'high',
            title: `Add ${skill} to your resume`,
            reason: `The target role lists ${skill} as a required skill, but it isn’t present in your resume.`,
            evidence: [skill],
            action: `Add "${skill}" to the Skills section or demonstrate it in an experience/project bullet (only if you actually have it).`,
            relatedSection: 'skills',
            jobSpecific: true,
          });
        }
      }

      // Skills listed but not demonstrated
      for (const skill of resumeSkills) {
        if (jobSkills.has(skill)) {
          const demonstrated = this.isSkillDemonstrated(skill, input);
          if (!demonstrated) {
            recommendations.push({
              id: `undemonstrated_${skill}`,
              category: 'Skills and keywords',
              priority: 'medium',
              title: `Show evidence for ${skill}`,
              reason: `${skill} appears in your Skills list but no experience/project bullet backs it up.`,
              evidence: [skill],
              action: `Add a bullet that mentions how you used ${skill} (e.g., “Built a REST API with ${skill} …”).`,
              relatedSection: 'experience',
              jobSpecific: true,
            });
          }
        }
      }

      // Responsibility gaps
      const responsibilities = this.extractResponsibilities(jobDescription);
      const missingResp = responsibilities.filter(
        (r) => !input.sections.experience.toLowerCase().includes(r.toLowerCase()),
      );
      missingResp.slice(0, 3).forEach((resp) => {
        recommendations.push({
          id: `missing_resp_${resp.replace(/\s+/g, '_')}`,
          category: 'Target-job alignment',
          priority: 'high',
          title: `Add responsibility: ${resp}`,
          reason: `The job expects you to ${resp}, but it’s not reflected in your experience bullets.`,
          evidence: [resp],
          action: `Add a bullet under an appropriate role that shows you have “${resp}”.`,
          relatedSection: 'experience',
          jobSpecific: true,
        });
      });
    }

    // ---- Common polish rules (apply to both cases) ----
    this.applyPolishRules(input, recommendations);

    // Keep only top 5 highest‑impact recommendations (sorted by priority then category)
    const priorityMap = { high: 3, medium: 2, low: 1 };
    recommendations.sort(
      (a, b) =>
        priorityMap[b.priority] - priorityMap[a.priority] ||
        a.category.localeCompare(b.category),
    );
    return recommendations.slice(0, 5);
  }

  /** General ATS / resume‑quality rules */
  private applyGeneralRules(input: RecommendationInput, out: Recommendation[]) {
    // Missing contact basics
    if (!input.basics.emails.length) {
      out.push(this.makeRec('email_missing', 'Parsing and formatting', 'high', 'Add email address', 'Contact email is essential for recruiters.', ['No email found'], 'Add a professional email to the header.'));
    }
    if (!input.basics.phones.length) {
      out.push(this.makeRec('phone_missing', 'Parsing and formatting', 'high', 'Add phone number', 'Phone number enables quick follow‑up.', ['No phone found'], 'Add a reachable phone number with country code.'));
    }

    // Weak summary
    if (input.sections.summary.trim().length < 30) {
      out.push(this.makeRec('summary_weak', 'Required sections', 'medium', 'Add a concise summary', 'A strong summary quickly tells recruiters who you are.', ['Summary is very short'], 'Write a 2–4 sentence professional summary.'));
    }

    // Too few skills
    const skillCount = input.skills.length;
    if (skillCount < 8) {
      out.push(this.makeRec('skills_few', 'Skills and keywords', 'high', 'Add more skills', `Only ${skillCount} skills detected (8–12 ideal).`, [], 'List additional technologies you actually know.'));
    }

    // Weak experience bullets / lack of numbers
    const bulletCount = (input.sections.experience.match(/\n\s*[•\-*]/g) ?? []).length;
    if (bulletCount < 5) {
      out.push(this.makeRec('exp_few_bullets', 'Experience quality', 'high', 'Add more experience bullets', `Only ${bulletCount} bullets detected (8+ ideal).`, [], 'Add a bullet per responsibility or achievement.'));
    }

    // Weak verbs
    const verbList = ['built','designed','developed','implemented','led','owned','launched','shipped','migrated','reduced','increased','improved','automated','optimised','optimized','refactored','mentored','collaborated','delivered','architected'];
    const verbHits = verbList.filter(v => new RegExp(`\\b${v}\\b`, 'i').test(input.rawText)).length;
    if (verbHits < 4) {
      out.push(this.makeRec('exp_weak_verbs', 'Experience quality', 'medium', 'Use stronger action verbs', 'Few strong verbs detected.', [], 'Begin each bullet with a strong verb (e.g., “Built …”).'));
    }

    // ATS‑risk formatting (tables/columns)
    if (/(│|┌|─|├|┤|┬|┴|┼)/.test(input.rawText)) {
      out.push(this.makeRec('ats_tables', 'ATS compatibility', 'high', 'Remove tables/columns', 'Table‑like characters are ATS‑unfriendly.', [], 'Convert tables to single‑column bullet lists.'));
    }

    // Word count
    const words = input.rawText.split(/\s+/).filter(Boolean).length;
    if (words < 350 || words > 900) {
      out.push(this.makeRec('content_length', 'Content quality', 'medium', 'Adjust resume length', `Resume is ${words} words (ideal 350–900).`, [], 'Trim unnecessary fluff or add missing details to fall within the range.'));
    }
  }

  /** Polishing rules that apply regardless of job description */
  private applyPolishRules(input: RecommendationInput, out: Recommendation[]) {
    // Duplicate lines
    const lines = input.rawText.split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(Boolean);
    const dup = lines.filter((l,i) => lines.indexOf(l) !== i);
    if (dup.length) {
      out.push(this.makeRec('content_duplicate', 'Content quality', 'low', 'Remove duplicate lines', 'Repeated phrasing detected.', dup, 'Delete or rewrite duplicated lines.'));
    }
  }

  /** Helper to build a Recommendation object */
  private makeRec(
    id: string,
    category: RecommendationCategory,
    priority: 'high' | 'medium' | 'low',
    title: string,
    reason: string,
    evidence: string[],
    action: string,
    related?: Recommendation['relatedSection'],
    jobSpecific = false,
  ): Recommendation {
    return {
      id,
      category,
      priority,
      title,
      reason,
      evidence,
      action,
      relatedSection: related,
      jobSpecific,
    };
  }

  /** Simple heuristic – does any experience/project bullet contain the skill? */
  private isSkillDemonstrated(skill: string, input: RecommendationInput): boolean {
    const needle = new RegExp(`\\b${skill}\\b`, 'i');
    const sections = [input.sections.experience, input.sections.projects];
    return sections.some((s) => needle.test(s));
  }

  /** Very naive responsibility extractor – looks for verbs + nouns in the JD */
  private extractResponsibilities(jobDesc: string): string[] {
    // Split on sentences and grab those containing a verb + “…” phrase.
    const sentences = jobDesc.split(/[.!?]\s+/);
    const verbs = ['manage','lead','drive','own','design','build','implement','maintain','optimize','improve'];
    const results: string[] = [];
    for (const s of sentences) {
      for (const v of verbs) {
        if (new RegExp(`\\b${v}\\b`, 'i').test(s)) {
          results.push(s.trim());
          break;
        }
      }
    }
    return results;
  }
}