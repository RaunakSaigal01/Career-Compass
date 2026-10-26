'use client';

import { useState, useEffect } from 'react';

export interface JobItem {
  _id?: string;
  jobId?: string;
  externalId?: string;
  title: string;
  company: string;
  companyLogo?: string;
  location?: string;
  workMode?: string;
  salarySnippet?: string;
  platform?: string;
  source?: string;
  applyUrl?: string;
  url?: string;
  description?: string;
  requiredSkills?: string[];
  matchedSkills?: string[];
  missingSkills?: string[];
  matchScore?: number;
  postedAt?: string | Date;
}

export function deduplicateJobsList(jobs: JobItem[]): JobItem[] {
  if (!Array.isArray(jobs)) return [];
  const seenExternalIds = new Map<string, JobItem>();
  const seenUrls = new Map<string, JobItem>();
  const seenCompanyTitle = new Map<string, JobItem>();
  const deduped: JobItem[] = [];

  for (const job of jobs) {
    if (!job) continue;
    const externalId = job.externalId || job.jobId || job._id || '';

    // Normalize apply URL
    let normUrl = '';
    const rawUrl = job.applyUrl || job.url;
    if (rawUrl && typeof rawUrl === 'string') {
      try {
        const u = new URL(rawUrl.trim());
        const trackingParams = [
          'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
          'ref', 'refid', 'trackingid', 'subid', 'source', 'spm', 'from',
          'fbclid', 'gclid', 'msclkid', 'trk', 'midtoken', 'tracking_id',
        ];
        for (const p of Array.from(u.searchParams.keys())) {
          if (trackingParams.includes(p.toLowerCase()) || p.toLowerCase().startsWith('utm_')) {
            u.searchParams.delete(p);
          }
        }
        u.pathname = u.pathname.replace(/\/+$/, '');
        if (u.pathname.length > 1) {
          normUrl = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search ? u.search : ''}`;
        }
      } catch {
        const stripped = rawUrl.trim().split('?')[0].replace(/\/+$/, '').toLowerCase();
        if (stripped.length > 10) normUrl = stripped;
      }
    }

    // Normalize company
    const normCompany = (job.company || '')
      .toLowerCase()
      .replace(/\b(pvt|private|ltd|limited|llc|inc|corp|corporation|llp|gmbh|india)\b/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();

    // Normalize title
    const normTitle = (job.title || '')
      .toLowerCase()
      .replace(/\s*[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ')
      .replace(/\s*[\-|–|—|•|\|].*$/, ' ')
      .replace(/\b(immediate joiner|urgent hiring|urgently hiring|work from home|remote|hybrid|full time|part time)\b/gi, ' ')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const compTitleKey =
      normCompany.length >= 2 && normTitle.length >= 3
        ? `${normCompany}::${normTitle}`
        : '';

    let primary: JobItem | null = null;
    if (externalId && seenExternalIds.has(externalId)) {
      primary = seenExternalIds.get(externalId)!;
    } else if (normUrl && seenUrls.has(normUrl)) {
      primary = seenUrls.get(normUrl)!;
    } else if (compTitleKey && seenCompanyTitle.has(compTitleKey)) {
      primary = seenCompanyTitle.get(compTitleKey)!;
    }

    if (primary) {
      if (externalId && !seenExternalIds.has(externalId)) seenExternalIds.set(externalId, primary);
      if (normUrl && !seenUrls.has(normUrl)) seenUrls.set(normUrl, primary);
      if (compTitleKey && !seenCompanyTitle.has(compTitleKey)) seenCompanyTitle.set(compTitleKey, primary);

      if (!primary.salarySnippet && job.salarySnippet) {
        primary.salarySnippet = job.salarySnippet;
      }
      if (!primary.companyLogo && job.companyLogo) {
        primary.companyLogo = job.companyLogo;
      }
      if (primary.workMode === 'On-Site' && (job.workMode === 'Remote' || job.workMode === 'Hybrid')) {
        primary.workMode = job.workMode;
      }
      if (Array.isArray(job.requiredSkills) && job.requiredSkills.length > 0) {
        const pSkills = Array.isArray(primary.requiredSkills) ? primary.requiredSkills : [];
        primary.requiredSkills = Array.from(new Set([...pSkills, ...job.requiredSkills]));
      }
      continue;
    }

    const uniqueJob = { ...job };
    if (externalId) seenExternalIds.set(externalId, uniqueJob);
    if (normUrl) seenUrls.set(normUrl, uniqueJob);
    if (compTitleKey) seenCompanyTitle.set(compTitleKey, uniqueJob);
    deduped.push(uniqueJob);
  }

  return deduped;
}

interface JobCardProps {
  job: JobItem;
  isSaved?: boolean;
  onToggleSave?: (job: JobItem, isSaved: boolean) => void;
}

export default function JobCard({
  job,
  isSaved = false,
  onToggleSave,
}: JobCardProps) {
  const [saved, setSaved] = useState(isSaved);

  useEffect(() => {
    setSaved(isSaved);
  }, [isSaved]);

  const platformName = job.platform || job.source || 'Direct';
  const applyLink = job.applyUrl || job.url || '#';

  // Format posted date if available
  const formattedDate = job.postedAt
    ? (() => {
        try {
          const date = new Date(job.postedAt);
          return isNaN(date.getTime())
            ? null
            : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
          return null;
        }
      })()
    : null;

  // Platform badge styles
  const getPlatformBadgeStyle = (platform: string) => {
    switch (platform.toLowerCase()) {
      case 'linkedin':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'naukri':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'indeed':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'glassdoor':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      default:
        return 'bg-zinc-100 text-zinc-700 border-zinc-200';
    }
  };

  const handleSaveClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const nextState = !saved;
    setSaved(nextState);

    if (onToggleSave) {
      onToggleSave(job, nextState);
    }
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5 hover:border-zinc-300 transition-colors shadow-xs">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        {/* Left / Main Info */}
        <div className="flex-1 min-w-0 space-y-2.5">
          {/* Header: Title & Platform Badge */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-base font-semibold text-zinc-900 tracking-tight">
              {job.title}
            </h3>
            {platformName && (
              <span
                className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md border ${getPlatformBadgeStyle(
                  platformName,
                )}`}
              >
                {platformName}
              </span>
            )}
          </div>

          {/* Company & Location */}
          <div className="flex items-center gap-2 text-sm text-zinc-600 font-medium flex-wrap">
            <span>{job.company}</span>
            {job.location && (
              <>
                <span className="text-zinc-300">•</span>
                <span>{job.location}</span>
              </>
            )}
            {job.workMode && (
              <>
                <span className="text-zinc-300">•</span>
                <span className="text-xs px-2 py-0.5 bg-zinc-100 text-zinc-700 rounded border border-zinc-200 font-normal">
                  {job.workMode}
                </span>
              </>
            )}
          </div>

          {/* Metadata Row: Salary & Posted Date */}
          <div className="flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
            {job.salarySnippet && (
              <span className="font-semibold text-zinc-800">
                {job.salarySnippet}
              </span>
            )}
            {formattedDate && (
              <>
                {job.salarySnippet && <span className="text-zinc-300">•</span>}
                <span>Posted {formattedDate}</span>
              </>
            )}
          </div>

          {/* Short Description if available */}
          {job.description && (
            <p className="text-xs text-zinc-600 line-clamp-2 leading-relaxed pt-1">
              {job.description}
            </p>
          )}

          {/* Skills tags if available */}
          {((job.requiredSkills && job.requiredSkills.length > 0) ||
            (job.matchedSkills && job.matchedSkills.length > 0)) && (
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              {(job.matchedSkills || job.requiredSkills)?.slice(0, 6).map((skill) => (
                <span
                  key={skill}
                  className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded border border-zinc-200"
                >
                  {skill}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right / Actions: Save & Apply */}
        <div className="flex items-center gap-2.5 md:items-start justify-end pt-2 md:pt-0 shrink-0">
          <button
            type="button"
            onClick={handleSaveClick}
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border transition-all active:scale-[0.98] ${
              saved
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900'
            }`}
          >
            <span>{saved ? '★ Saved' : '☆ Save Job'}</span>
          </button>

          <a
            href={applyLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold rounded-md transition-colors whitespace-nowrap active:scale-[0.98]"
          >
            <span>Apply on {platformName}</span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </div>
  );
}