import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Job, JobDocument } from './schemas/job.schema';
import mongoose, { Model } from 'mongoose';
import { SavedJob, SavedJobDocument } from './schemas/saved-job.schema';
import { UsersService } from '../users/users.service';
import { BookmarkJobDto } from './dto/bookmark-job.dto';
import { Resume, ResumeDocument } from '../resumes/schemas/resumes.schema';

export interface NormalizedJob {
  externalId: string;
  title: string;
  targetRole?: string;
  company: string;
  companyLogo?: string;
  location: string;
  workMode: string;
  platform: string;
  applyUrl: string;
  description: string;
  requiredSkills: string[];
  salarySnippet?: string;
  postedAt?: Date;
  cachedAt?: Date;
}

interface JSearchJob {
  job_id: string;
  employer_name: string;
  employer_logo?: string;
  job_title: string;
  job_description: string;
  job_employment_type?: string;
  job_apply_link: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_posted_at_datetime_utc?: string;
  job_posted_at_timestamp?: number;
  job_salary?: string;
  job_salary_min?: number;
  job_salary_max?: number;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_period?: string;
  job_salary_currency?: string;
  job_required_skills?: string[];
  job_publisher?: string;
  apply_options?: Array<{ apply_link: string; publisher?: string }>;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly rapidApiKey: string;
  private readonly jsearchBaseUrl = 'https://jsearch.p.rapidapi.com';
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours

  constructor(
    @InjectModel(Job.name) private jobModel: Model<JobDocument>,
    @InjectModel(SavedJob.name) private savedJobModel: Model<SavedJobDocument>,
    @InjectModel(Resume.name) private resumeModel: Model<ResumeDocument>,
    private usersService: UsersService,
    private configService: ConfigService,
  ) {
    this.rapidApiKey = this.configService.get<string>('RAPIDAPI_KEY') || '';
  }

  async fetchRecommendations(userId: string): Promise<any[]> {
    try {
      const profile = await this.usersService.getProfile(userId);
      if (!profile) {
        return [];
      }

      const preferredRoles = (profile.preferredRoles && profile.preferredRoles.length > 0)
        ? profile.preferredRoles
        : ['Software Engineer'];
      const selectedResume = profile.primaryResumeId
        ? await this.resumeModel
            .findOne({ _id: profile.primaryResumeId, userId })
            .select('parsedProfile')
            .exec()
        : null;
      const resumeSkills = Array.isArray(selectedResume?.parsedProfile?.skills)
        ? (selectedResume.parsedProfile.skills as string[])
        : [];
      const candidateSkills = [...new Set([...(profile.masterSkills || []), ...resumeSkills])];
      const masterSkills = candidateSkills.map((s) => s.toLowerCase());

      const cacheCutoff = new Date(Date.now() - this.CACHE_TTL_MS);

      // 1. Check MongoDB cache for fresh jobs (< 24 hrs old) matching target roles
      let cachedJobs = await this.jobModel
        .find({
          title: { $in: preferredRoles.map((role) => new RegExp(role, 'i')) },
          cachedAt: { $gte: cacheCutoff },
        })
        .exec();

      let activeJobs: any[] = [];

      if (cachedJobs.length > 0) {
        this.logger.log(
          `[CACHE HIT] Found ${cachedJobs.length} cached jobs (< 24h old). Skipping external API call.`,
        );
        activeJobs = cachedJobs.map((doc) =>
          typeof (doc as any).toObject === 'function' ? (doc as any).toObject() : doc,
        );
      } else {
        this.logger.log(
          `[CACHE MISS / EXPIRED] No valid cache found for roles: ${preferredRoles.join(', ')}. Fetching fresh jobs from API...`,
        );

        // Fetch fresh jobs from API
        const freshJobs = await this.fetchExternalJobs(preferredRoles, candidateSkills);

        if (freshJobs.length > 0) {
          // Remove old expired cache entries
          await this.jobModel.deleteMany({
            cachedAt: { $lt: cacheCutoff },
          });

          // Save fresh jobs into MongoDB cache with current timestamp
          for (const job of freshJobs) {
            await this.jobModel.updateOne(
              { externalId: job.externalId },
              { $set: { ...job, cachedAt: new Date() } },
              { upsert: true },
            );
          }

          activeJobs = freshJobs;
        } else {
          // Fallback to any existing cached jobs if external API is temporarily down
          const fallbackJobs = await this.jobModel
            .find({
              title: { $in: preferredRoles.map((role) => new RegExp(role, 'i')) },
            })
            .exec();
          activeJobs = fallbackJobs.map((doc) =>
            typeof (doc as any).toObject === 'function' ? (doc as any).toObject() : doc,
          );
        }
      }

      // Deduplicate using multi-factor rules and identify duplicate documents to purge
      const { deduped: dedupedJobs, duplicateIds } = this.deduplicateJobsWithDetails(activeJobs);

      // Self-healing: purge duplicate records from MongoDB cached_jobs
      if (duplicateIds.length > 0) {
        this.logger.log(
          `[CACHE CLEANUP] Found ${duplicateIds.length} duplicate cached job records in DB. Purging...`,
        );
        this.jobModel
          .deleteMany({ _id: { $in: duplicateIds } })
          .exec()
          .catch((err) => {
            this.logger.warn(`Failed to purge duplicate jobs from DB: ${err.message}`);
          });
      }

      // Calculate match score for each job based on candidate's skills
      const jobsWithScore = dedupedJobs.map((job) => {
        const jobSkills = (job.requiredSkills || []).map((s: string) => s.toLowerCase());
        const matchedSkills = jobSkills.filter((skill: string) =>
          masterSkills.some((ms) => ms === skill || ms.includes(skill) || skill.includes(ms)),
        );
        const missingSkills = jobSkills.filter(
          (skill: string) => !matchedSkills.includes(skill),
        );

        const matchScore =
          jobSkills.length > 0
            ? Math.min(100, Math.max(60, Math.round((matchedSkills.length / jobSkills.length) * 100)))
            : 85;

        const raw = job as any;
        const jobObj = typeof raw.toObject === 'function' ? raw.toObject() : raw;

        return {
          ...jobObj,
          workMode: jobObj.workMode || 'On-Site',
          matchScore,
          matchedSkills,
          missingSkills,
        };
      });

      // Sort by postedAt descending (LATEST posted jobs 1st)
      return jobsWithScore.sort((a, b) => {
        const timeA = a.postedAt ? new Date(a.postedAt).getTime() : 0;
        const timeB = b.postedAt ? new Date(b.postedAt).getTime() : 0;
        if (timeB !== timeA) {
          return timeB - timeA;
        }
        return (b.matchScore || 0) - (a.matchScore || 0);
      });
    } catch (error) {
      this.logger.error(`Failed to fetch recommendations: ${error.message}`);
      return [];
    }
  }

  async fetchExternalJobs(
    preferredRoles: string[],
    candidateSkills: string[] = [],
  ): Promise<NormalizedJob[]> {
    if (!this.rapidApiKey) {
      return [];
    }

    try {
      const jobs = await this.fetchFromJSearch(preferredRoles, candidateSkills);
      return jobs;
    } catch (error) {
      this.logger.error(`JSearch API failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetches real live job listings from JSearch /search-v2 API
   */
  private async fetchFromJSearch(
    preferredRoles: string[],
    candidateSkills: string[],
  ): Promise<NormalizedJob[]> {
    const roles = preferredRoles.length > 0 ? preferredRoles : ['Software Engineer'];
    const allJobs: NormalizedJob[] = [];

    for (const role of roles.slice(0, 2)) {
      const query = `${role} jobs in India`;
      this.logger.log(`Fetching live jobs from JSearch for: "${query}"`);

      try {
        const response = await fetch(
          `${this.jsearchBaseUrl}/search-v2?query=${encodeURIComponent(query)}&num_pages=1&country=in&date_posted=all`,
          {
            headers: {
              'X-RapidAPI-Key': this.rapidApiKey,
              'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
            },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          this.logger.error(`JSearch API error: ${response.status} ${errorText}`);
          continue;
        }

        const resData = await response.json();
        const rawJobs: JSearchJob[] = resData.data?.jobs || (Array.isArray(resData.data) ? resData.data : []);

        this.logger.log(`Received ${rawJobs.length} live job listings from JSearch`);

        for (const rawJob of rawJobs) {
          const normalized = this.normalizeJSearchJob(rawJob, role);
          allJobs.push(normalized);
        }
      } catch (err: any) {
        this.logger.error(`Failed to query JSearch: ${err.message}`);
      }
    }

    // Deduplicate using multi-factor rules
    const deduped = this.deduplicateJobs(allJobs);
    return deduped;
  }

  /**
   * Normalizes JSearch real API response into the application job format
   */
  private normalizeJSearchJob(job: JSearchJob, targetRole: string): NormalizedJob {
    // Determine platform / source from publisher or URL
    const publisher = (job.job_publisher || '').toLowerCase();
    const applyLink = job.job_apply_link || job.apply_options?.[0]?.apply_link || '';

    let platform = job.job_publisher || 'Direct';
    if (publisher.includes('linkedin') || applyLink.includes('linkedin.com')) platform = 'LinkedIn';
    else if (publisher.includes('indeed') || applyLink.includes('indeed.com')) platform = 'Indeed';
    else if (publisher.includes('naukri') || applyLink.includes('naukri.com')) platform = 'Naukri';
    else if (publisher.includes('glassdoor') || applyLink.includes('glassdoor.com')) platform = 'Glassdoor';

    // Work Mode
    let workMode = 'On-Site';
    if (job.job_is_remote) {
      workMode = 'Remote';
    } else if (job.job_description?.toLowerCase().includes('hybrid')) {
      workMode = 'Hybrid';
    }

    // Location
    const locationParts = [job.job_city, job.job_state, job.job_country].filter(Boolean);
    const location = locationParts.length > 0 ? locationParts.join(', ') : 'India';

    // Posted date
    let postedAt: Date = new Date();
    if (job.job_posted_at_datetime_utc) {
      postedAt = new Date(job.job_posted_at_datetime_utc);
    } else if (job.job_posted_at_timestamp) {
      postedAt = new Date(job.job_posted_at_timestamp * 1000);
    }

    // Extract exact salary (yearly/monthly pay) from listing fields or description
    const salarySnippet = this.extractSalary(job);

    // Extract skills from required_skills or description
    const requiredSkills =
      job.job_required_skills && job.job_required_skills.length > 0
        ? job.job_required_skills
        : this.extractSkillsFromDescription(job.job_description);

    return {
      externalId: `jsearch-${job.job_id}`,
      title: job.job_title,
      targetRole,
      company: job.employer_name,
      companyLogo: job.employer_logo,
      location,
      workMode,
      platform,
      applyUrl: applyLink,
      description: (job.job_description || '').slice(0, 500),
      requiredSkills,
      salarySnippet,
      postedAt,
      cachedAt: new Date(),
    };
  }

  /**
   * Extracts listed yearly/monthly salary from API fields or description text
   */
  private extractSalary(job: JSearchJob): string | undefined {
    // 1. Direct explicit job_salary string
    if (job.job_salary && typeof job.job_salary === 'string' && job.job_salary.trim()) {
      return job.job_salary.trim();
    }

    // 2. Structured min/max salary fields
    const min = job.job_salary_min || job.job_min_salary;
    const max = job.job_salary_max || job.job_max_salary;
    const period = (job.job_salary_period || 'year').toLowerCase();
    const isIndia = (job.job_country || '').toLowerCase().includes('in');
    const currency = job.job_salary_currency || (isIndia ? 'INR' : 'USD');
    const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';

    const periodLabel = period.includes('hour') ? '/ hr' : period.includes('month') ? '/ mo' : '/ yr';

    if (min && max) {
      return `${symbol}${Math.round(min).toLocaleString(isIndia ? 'en-IN' : 'en-US')} - ${symbol}${Math.round(max).toLocaleString(isIndia ? 'en-IN' : 'en-US')} ${periodLabel}`;
    } else if (min) {
      return `From ${symbol}${Math.round(min).toLocaleString(isIndia ? 'en-IN' : 'en-US')} ${periodLabel}`;
    } else if (max) {
      return `Up to ${symbol}${Math.round(max).toLocaleString(isIndia ? 'en-IN' : 'en-US')} ${periodLabel}`;
    }

    // 3. Regex extraction from description text
    const desc = job.job_description || '';
    if (desc) {
      // LPA / Lakhs pattern (e.g. 18-28 LPA, 20 LPA, 15 Lakhs per annum)
      const lpaMatch = desc.match(/\b(\d+(?:\.\d+)?\s*(?:-\s*\d+(?:\.\d+)?\s*)?\s*(?:LPA|L\.P\.A|Lakhs?(?:\s*(?:per\s*annum|PA|P\.A\.|\/yr))?))\b/i);
      if (lpaMatch) {
        return `₹${lpaMatch[1].trim()}`;
      }

      // Currency + frequency pattern (e.g. ₹50,000 - ₹80,000 / month, $120,000 - $160,000 a year)
      const salaryMatch = desc.match(/([₹$€£]\s*[\d,]+(?:\s*-\s*[₹$€£]?\s*[\d,]+)?\s*(?:per\s+(?:annum|year|month|hr|hour)|\/yr|\/mo|\/month|\/year|\/hr|a\s+year|a\s+month|annually|hourly|PA|P\.A\.))/i);
      if (salaryMatch) {
        return salaryMatch[1].trim();
      }

      // Explicit "Salary: ..." or "CTC: ..." or "Compensation: ..."
      const prefixMatch = desc.match(/(?:salary|compensation|ctc|pay|stipend)\s*[:\-]\s*([₹$€£\d][^\n\.,;]{2,40})/i);
      if (prefixMatch) {
        return prefixMatch[1].trim();
      }
    }

    return undefined;
  }

  private extractSkillsFromDescription(description?: string): string[] {
    if (!description) return [];

    const commonSkills = [
      'JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust',
      'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'SQL', 'PostgreSQL', 'MongoDB',
      'Redis', 'GraphQL', 'REST', 'Microservices', 'CI/CD', 'Git', 'Linux',
      'Spring Boot', 'Django', 'FastAPI', 'Express', 'Next.js', 'Vue', 'Angular',
      'Swift', 'Kotlin', 'Flutter', 'React Native', 'Machine Learning', 'AI',
    ];

    const lower = description.toLowerCase();
    return commonSkills.filter((skill) => {
      const regex = new RegExp(`\\b${skill.toLowerCase().replace(/\+/g, '\\+')}\\b`, 'i');
      return regex.test(lower);
    }).slice(0, 8);
  }

  /**
   * Normalizes an apply URL by stripping query tracking params and trailing slashes
   */
  private normalizeApplyUrl(rawUrl?: string): string | null {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;
    try {
      const url = new URL(trimmed);
      const trackingParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'ref', 'refid', 'trackingid', 'subid', 'source', 'spm', 'from',
        'fbclid', 'gclid', 'msclkid', 'trk', 'midtoken', 'tracking_id',
      ];
      for (const param of Array.from(url.searchParams.keys())) {
        if (trackingParams.includes(param.toLowerCase()) || param.toLowerCase().startsWith('utm_')) {
          url.searchParams.delete(param);
        }
      }
      url.pathname = url.pathname.replace(/\/+$/, '');
      if (url.pathname.length <= 1) return null;
      return `${url.protocol}//${url.host.toLowerCase()}${url.pathname}${url.search ? url.search : ''}`;
    } catch {
      const stripped = trimmed.split('?')[0].replace(/\/+$/, '').toLowerCase();
      return stripped.length > 10 ? stripped : null;
    }
  }

  /**
   * Cleans company name by removing legal/corporate suffixes and special characters
   */
  private normalizeCompany(company?: string): string {
    if (!company || typeof company !== 'string') return '';
    return company
      .toLowerCase()
      .replace(/\b(pvt|private|ltd|limited|llc|inc|corp|corporation|llp|gmbh|india)\b/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /**
   * Cleans job title by removing brackets, trailing location/employment phrases, and buzzwords
   */
  private normalizeJobTitle(title?: string): string {
    if (!title || typeof title !== 'string') return '';
    return title
      .toLowerCase()
      // Remove bracketed or parenthesized tags like (Remote), [Immediate Joiner], etc.
      .replace(/\s*[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ')
      // Remove trailing delimiter phrases like " - Remote", " | Full Time", " • Bangalore"
      .replace(/\s*[\-|–|—|•|\|].*$/, ' ')
      // Remove common buzzwords that recruiters append
      .replace(/\b(immediate joiner|urgent hiring|urgently hiring|work from home|remote|hybrid|full time|part time)\b/gi, ' ')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Multi-factor job deduplication helper
   */
  public deduplicateJobs<T extends any>(jobs: T[]): T[] {
    const { deduped } = this.deduplicateJobsWithDetails(jobs);
    return deduped;
  }

  /**
   * Deduplicates jobs and identifies duplicate MongoDB _id records for purging
   */
  public deduplicateJobsWithDetails<T extends any>(jobs: T[]): { deduped: T[]; duplicateIds: any[] } {
    const seenExternalIds = new Map<string, T>();
    const seenUrls = new Map<string, T>();
    const seenCompanyTitle = new Map<string, T>();
    const deduped: T[] = [];
    const duplicateIds: any[] = [];

    for (const job of jobs) {
      const rawJob = job as any;
      const externalId = rawJob.externalId || rawJob.jobId || (rawJob._id ? rawJob._id.toString() : '');
      const normUrl = this.normalizeApplyUrl(rawJob.applyUrl || rawJob.url);
      const normCompany = this.normalizeCompany(rawJob.company);
      const normTitle = this.normalizeJobTitle(rawJob.title);
      const compTitleKey =
        normCompany.length >= 2 && normTitle.length >= 3
          ? `${normCompany}::${normTitle}`
          : '';

      // Check if duplicate exists
      let primary: any = null;
      if (externalId && seenExternalIds.has(externalId)) {
        primary = seenExternalIds.get(externalId);
      } else if (normUrl && seenUrls.has(normUrl)) {
        primary = seenUrls.get(normUrl);
      } else if (compTitleKey && seenCompanyTitle.has(compTitleKey)) {
        primary = seenCompanyTitle.get(compTitleKey);
      }

      if (primary) {
        // Collect DB ID of the duplicate record if it exists
        if (rawJob._id && primary._id && rawJob._id.toString() !== primary._id.toString()) {
          duplicateIds.push(rawJob._id);
        }

        // Register aliases to primary for transitive matching
        if (externalId && !seenExternalIds.has(externalId)) seenExternalIds.set(externalId, primary);
        if (normUrl && !seenUrls.has(normUrl)) seenUrls.set(normUrl, primary);
        if (compTitleKey && !seenCompanyTitle.has(compTitleKey)) seenCompanyTitle.set(compTitleKey, primary);

        // Merge richer metadata into primary
        if (!primary.salarySnippet && rawJob.salarySnippet) {
          primary.salarySnippet = rawJob.salarySnippet;
        }
        if (!primary.companyLogo && rawJob.companyLogo) {
          primary.companyLogo = rawJob.companyLogo;
        }
        if (primary.workMode === 'On-Site' && (rawJob.workMode === 'Remote' || rawJob.workMode === 'Hybrid')) {
          primary.workMode = rawJob.workMode;
        }
        if (Array.isArray(rawJob.requiredSkills) && rawJob.requiredSkills.length > 0) {
          const primarySkills = Array.isArray(primary.requiredSkills) ? primary.requiredSkills : [];
          const combined = Array.from(new Set([...primarySkills, ...rawJob.requiredSkills]));
          primary.requiredSkills = combined;
        }
        const primaryTime = primary.postedAt ? new Date(primary.postedAt).getTime() : 0;
        const jobTime = rawJob.postedAt ? new Date(rawJob.postedAt).getTime() : 0;
        if (jobTime > primaryTime) {
          primary.postedAt = rawJob.postedAt;
        }

        continue;
      }

      // If new unique job
      if (externalId) seenExternalIds.set(externalId, job);
      if (normUrl) seenUrls.set(normUrl, job);
      if (compTitleKey) seenCompanyTitle.set(compTitleKey, job);
      deduped.push(job);
    }

    return { deduped, duplicateIds };
  }

  getPlatformDeepLinks(role: string, location?: string): Record<string, string> {
    const encodedRole = encodeURIComponent(role);
    const loc = location || 'India';
    const encodedLocation = encodeURIComponent(loc);

    return {
      LinkedIn: `https://www.linkedin.com/jobs/search/?keywords=${encodedRole}&location=${encodedLocation}`,
      Indeed: `https://in.indeed.com/jobs?q=${encodedRole}&l=${encodedLocation}`,
      Naukri: `https://www.naukri.com/${role.toLowerCase().replace(/\s+/g, '-')}-jobs`,
      Glassdoor: `https://www.glassdoor.co.in/Job/jobs.htm?sc.keyword=${encodedRole}`,
    };
  }

  async bookmarkJob(userId: string, dto: BookmarkJobDto): Promise<SavedJob> {
    try {
      const existing = await this.savedJobModel
        .findOne({
          userId,
          jobId: dto.jobId,
        })
        .exec();

      const jobPayload = {
        userId,
        jobId: dto.jobId,
        title: dto.title,
        company: dto.company,
        location: dto.location,
        workMode: dto.workMode || 'On-Site',
        salarySnippet: dto.salarySnippet || '',
        platform: dto.platform,
        applyUrl: dto.applyUrl,
        matchScore: dto.matchScore || 85,
        matchedSkills: dto.matchedSkills || [],
        missingSkills: dto.missingSkills || [],
        status: dto.status || 'saved',
        notes: dto.notes || '',
        appliedDate: dto.appliedDate || new Date(),
      };

      if (existing) {
        Object.assign(existing, jobPayload);
        return await existing.save();
      } else {
        const savedJob = new this.savedJobModel(jobPayload);
        return await savedJob.save();
      }
    } catch (error) {
      throw new InternalServerErrorException(`Failed to bookmark job: ${error.message}`);
    }
  }

  async listSavedJobs(userId: string): Promise<SavedJob[]> {
    try {
      const list = await this.savedJobModel.find({ userId }).sort({ appliedDate: -1, _id: -1 }).exec();
      const plainList = list.map((doc) =>
        typeof (doc as any).toObject === 'function' ? (doc as any).toObject() : doc,
      );
      return this.deduplicateJobs(plainList);
    } catch (error) {
      throw new InternalServerErrorException(`Failed to list saved jobs: ${error.message}`);
    }
  }

  async updateSavedJobStatus(
    userId: string,
    id: string,
    status: string,
    notes?: string,
  ): Promise<SavedJob> {
    try {
      const isObjectId = mongoose.Types.ObjectId.isValid(id);
      const query = isObjectId
        ? { $or: [{ _id: id }, { jobId: id }], userId }
        : { jobId: id, userId };

      const savedJob = await this.savedJobModel.findOne(query).exec();

      if (!savedJob) {
        throw new Error('Saved job not found');
      }

      savedJob.status = status;
      if (notes !== undefined) {
        savedJob.notes = notes;
      }
      if (status === 'applied' && !savedJob.appliedDate) {
        savedJob.appliedDate = new Date();
      }

      return await savedJob.save();
    } catch (error) {
      throw new InternalServerErrorException(`Failed to update saved job status: ${error.message}`);
    }
  }

  async deleteSavedJob(userId: string, id: string): Promise<void> {
    try {
      const isObjectId = mongoose.Types.ObjectId.isValid(id);
      const query = isObjectId
        ? { $or: [{ _id: id }, { jobId: id }], userId }
        : { jobId: id, userId };

      const result = await this.savedJobModel.deleteOne(query).exec();

      if (result.deletedCount === 0) {
        this.logger.debug(`No saved job found to delete for ID: ${id}`);
      }
    } catch (error) {
      throw new InternalServerErrorException(`Failed to delete saved job: ${error.message}`);
    }
  }

  async updateJob(externalId: string, jobData: Partial<Job>): Promise<void> {
    try {
      await this.jobModel
        .updateOne({ externalId }, { $set: jobData }, { upsert: true })
        .exec();
    } catch (error) {
      throw new InternalServerErrorException(`Failed to update job: ${error.message}`);
    }
  }
}
