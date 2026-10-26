import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { promises as fs } from 'fs';
import { extname } from 'path';
import { fileTypeFromBuffer } from 'file-type';
import { Resume, ResumeDocument } from './schemas/resumes.schema';
import { ParsingService, ParsedProfile } from '../parser/parsing.service';
import { ScoringService } from '../scoring/scoring.service';
import {
  ResumeAnalysis,
  ResumeAnalysisDocument,
} from '../scoring/schemas/resume-analysis.schema';
import { SKILLS_DICTIONARY } from '../parser/skills-dictionary';
import { UsersService } from 'src/users/users.service';
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
]);

const ALLOWED_EXTS = new Set(['.pdf', '.docx']);

@Injectable()
export class ResumesService {
  constructor(
    @InjectModel(Resume.name)
    private readonly resumeModel: Model<ResumeDocument>,
    @InjectModel(ResumeAnalysis.name)
    private readonly analysisModel: Model<ResumeAnalysisDocument>,
    private readonly parsingService: ParsingService,
    private readonly scoringService: ScoringService,
    private readonly usersService: UsersService,
  ) {}

  async getForUser(userId: string, resumeId: string): Promise<ResumeDocument> {
    const resume = await this.resumeModel
      .findOne({ _id: resumeId, userId })
      .exec();

    if (!resume) {
      throw new NotFoundException('Resume not found.');
    }

    return resume;
  }

   async parseAndStore(userId: string, resumeId: string): Promise<ResumeDocument> {
    const resume = await this.getForUser(userId, resumeId);
    try {
      const rawText = await this.parsingService.extractText(
        resume.storagePath,
        resume.mimeType,
      );
      const parsedProfile = await this.parsingService.parseProfile(rawText);
      resume.rawText = rawText;
      resume.parsedProfile = parsedProfile as unknown as Record<string, unknown>;
      resume.status = 'parsed';
      const savedResume = await resume.save();
      // Auto-sync into Master Profile (as non-destructive defaults)
      const parseLinks = [
        ...(parsedProfile.basics?.urls || []),
        ...(parsedProfile.basics?.linkedin ? [parsedProfile.basics.linkedin] : []),
        ...(parsedProfile.basics?.github ? [parsedProfile.basics.github] : []),
      ];
      await this.usersService
        .syncFromParsedResume(userId, resumeId, {
          name: parsedProfile.name,
          phone: parsedProfile.basics?.phones?.[0],
          linkedin: parsedProfile.basics?.linkedin,
          github: parsedProfile.basics?.github,
          links: parseLinks,
          skills: parsedProfile.skills,
        })
        .catch(() => null);
      return savedResume;
    } catch (error) {
      resume.status = 'failed';
      await resume.save();
      throw error;
    }
  }

  extractJobTitle(jd: string): string | null {
    if (!jd || !jd.trim()) return null;
    const lines = jd.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    const titlePatterns = [
      /(senior|junior|lead|staff|principal|mid[- ]?level)?\s*(software|frontend|backend|full[- ]?stack|devops|data|cloud|mobile|web|qa|ml|ai|ios|android)\s*(engineer|developer|architect|analyst|scientist|manager|intern)/i,
      /(product|project|engineering|technical|program)\s*(manager|lead|director|owner)/i,
      /(react\s*native|react|node\.js|python|java|golang|flutter|swift|ios|android)\s*(developer|engineer)/i,
    ];

    for (const rawLine of lines.slice(0, 8)) {
      // Strip common label prefixes like "Job Title:", "Role:", "Position:", "TITLE -"
      const line = rawLine
        .replace(
          /^(job\s*title|title|role|position|designation|job\s*role|looking\s*for)\s*[:–—\-]\s*/i,
          '',
        )
        .trim();

      for (const pattern of titlePatterns) {
        const match = line.match(pattern);
        if (match) {
          return match[0].trim();
        }
      }

      if (
        rawLine.match(/^(job\s*title|title|role|position)\s*[:–—\-]\s*/i) &&
        line.length > 0 &&
        line.length <= 60
      ) {
        return line.replace(/[:–—-]\s*$/, '').trim();
      }
    }

    if (lines.length > 0) {
      const firstLine = lines[0]
        .replace(
          /^(job\s*title|title|role|position|designation|job\s*role|looking\s*for)\s*[:–—\-]\s*/i,
          '',
        )
        .trim();
      if (
        firstLine.length > 0 &&
        firstLine.length <= 60 &&
        !firstLine.includes('.')
      ) {
        return firstLine.replace(/[:–—-]\s*$/, '').trim();
      }
    }

    return null;
  }

  async saveProfile(
    userId: string,
    resumeId: string,
    profile: unknown,
    jobDescription?: string,
  ): Promise<ResumeDocument> {
    const resume = await this.getForUser(userId, resumeId);
    resume.parsedProfile = profile as Record<string, unknown>;
    const savedResume = await resume.save();

    const targetRole = jobDescription
      ? this.extractJobTitle(jobDescription) ?? undefined
      : undefined;

    const p = profile as any;
    if (p) {
      const links = [
        ...(p.basics?.urls || []),
        ...(p.basics?.linkedin ? [p.basics.linkedin] : []),
        ...(p.basics?.github ? [p.basics.github] : []),
      ];

      await this.usersService
        .syncFromParsedResume(userId, resumeId, {
          name: p.name,
          phone: p.basics?.phones?.[0],
          linkedin: p.basics?.linkedin,
          github: p.basics?.github,
          links,
          skills: p.skills,
          targetRole,
        })
        .catch(() => null);
    }

    return savedResume;
  }
  async scoreResume(
    userId: string,
    resumeId: string,
    jobDescription?: string,
  ): Promise<ResumeAnalysisDocument> {
    const resume = await this.getForUser(userId, resumeId);
    const profile: ParsedProfile = (resume.parsedProfile as unknown as
      ParsedProfile | undefined) ?? {
      basics: {
        emails: [],
        phones: [],
        urls: [],
      },
      sections: {
        summary: '',
        education: '',
        experience: '',
        projects: '',
        skills: '',
        certifications: '',
        other: '',
      },
      skills: [],
      rawText: resume.rawText ?? '',
    };

    const targetRole = jobDescription
      ? this.extractJobTitle(jobDescription) ?? undefined
      : undefined;

    // Also sync target role to master profile when scoring
    if (targetRole) {
      await this.usersService
        .syncFromParsedResume(userId, resumeId, {
          targetRole,
        })
        .catch(() => null);
    }

    const jobKeywords = jobDescription
      ? this.extractJobKeywords(jobDescription)
      : [];

    const result = this.scoringService.buildAnalysis(
      String(resume._id),
      userId,
      {
        rawText: resume.rawText ?? '',
        skills: profile.skills ?? [],
        basics: {
          emails: profile.basics?.emails ?? [],
          phones: profile.basics?.phones ?? [],
          linkedin: profile.basics?.linkedin,
          github: profile.basics?.github,
        },
        sections: profile.sections ?? {
          summary: '',
          education: '',
          experience: '',
          projects: '',
          skills: '',
          certifications: '',
        },
        jobKeywords,
      },
      jobDescription,
    );

    const doc = await this.analysisModel.create(result);
    return doc;
  }

  async getLatestAnalysis(
    userId: string,
    resumeId: string,
  ): Promise<ResumeAnalysisDocument | null> {
    await this.getForUser(userId, resumeId); // ownership check
    return this.analysisModel
      .findOne({ resumeId, userId })
      .sort({ createdAt: -1 })
      .exec();
  }

  private extractJobKeywords(jobDescription: string): string[] {
    const text = jobDescription.toLowerCase();
    const found = new Set<string>();
    const sorted = [...SKILLS_DICTIONARY].sort((a, b) => b.length - a.length);
    for (const skill of sorted) {
      const escapedSkill = skill
        .toLowerCase()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^a-z0-9])${escapedSkill}([^a-z0-9]|$)`, 'i');
      if (re.test(text)) found.add(skill);
    }
    return [...found];
  }
  async validateAndCreate(
    userId: string,
    file: Express.Multer.File,
  ): Promise<ResumeDocument> {
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      await fs.unlink(file.path).catch(() => undefined);
      throw new NotFoundException('Only .pdf and .docx are allowed.');
    }

    const buffer = await fs.readFile(file.path);
    const detected = await fileTypeFromBuffer(buffer);

    const mimeOk =
      detected?.mime === file.mimetype && ALLOWED_MIMES.has(detected.mime);

    if (!mimeOk) {
      await fs.unlink(file.path).catch(() => undefined);
      throw new NotFoundException(
        'File signature does not match its extension.',
      );
    }

    return this.resumeModel.create({
      userId,
      originalName: file.originalname,
      storagePath: file.path,
      mimeType: file.mimetype,
      status: 'pending',
    });
  }

  listForUser(userId: string) {
    return this.resumeModel.find({ userId }).sort({ createdAt: -1 }).exec();
  }

  async deleteForUser(userId: string, resumeId: string) {
    const resume = await this.resumeModel
      .findOne({ _id: resumeId, userId })
      .exec();
    if (!resume) {
      throw new NotFoundException('Resume not found.');
    }
    await fs.unlink(resume.storagePath).catch(() => undefined);
    await this.resumeModel.deleteOne({ _id: resume._id }).exec();
    return { deleted: true };
  }
}
