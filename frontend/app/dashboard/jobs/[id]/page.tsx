'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const API_URL = 'http://localhost:3001';

interface JobItem {
  _id?: string;
  externalId?: string;
  title: string;
  company: string;
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

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [job, setJob] = useState<JobItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const jobId = params.id as string;

  const fetchJob = async () => {
    const token = localStorage.getItem('accessToken');
    const rawUser = localStorage.getItem('user');

    if (!token || !rawUser) {
      router.replace('/');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // First try to get job from search params (passed from JobCard)
      const jobDataParam = searchParams.get('jobData');
      if (jobDataParam) {
        try {
          const parsedJob = JSON.parse(decodeURIComponent(jobDataParam));
          setJob(parsedJob);
          setLoading(false);
          return;
        } catch (e) {
          console.warn('Failed to parse job data from URL, fetching from API');
        }
      }

      // Fallback: fetch all recommendations and find the matching job
      const res = await fetch(`${API_URL}/jobs/recommendations`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        router.replace('/');
        return;
      }

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();
      const jobList = Array.isArray(data) ? data : data?.jobs || [];

      // Find job by externalId or _id
      const foundJob = jobList.find(
        (j: JobItem) => j.externalId === jobId || j._id === jobId
      );

      if (foundJob) {
        setJob(foundJob);
      } else {
        setError('Job not found');
      }
    } catch (err: any) {
      console.error('Job detail API error:', err);
      setError("We couldn't load this job. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJob();
  }, [jobId, searchParams, router]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-[#fafafa]">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="space-y-4">
            <div className="h-8 bg-zinc-100 rounded w-1/3 animate-pulse" />
            <div className="h-4 bg-zinc-100 rounded w-full animate-pulse" />
            <div className="h-4 bg-zinc-100 rounded w-3/4 animate-pulse" />
            <div className="h-4 bg-zinc-100 rounded w-1/2 animate-pulse" />
            <div className="h-32 bg-zinc-100 rounded animate-pulse mt-4" />
            <div className="h-32 bg-zinc-100 rounded animate-pulse" />
            <div className="h-32 bg-zinc-100 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-[#fafafa]">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="bg-white border border-red-200 rounded-lg p-10 text-center space-y-3">
            <p className="text-sm font-semibold text-zinc-900">{error || 'Job not found'}</p>
            <Link
              href="/dashboard/jobs"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold rounded-md transition-colors"
            >
              <span>← Back to Jobs</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const platformName = job.platform || job.source || 'Direct';
  const applyLink = job.applyUrl || job.url || '#';

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

  const formatDate = (dateStr?: string | Date) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? null : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch {
      return null;
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#fafafa]">
      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* Back Button */}
        <Link
          href="/dashboard/jobs"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-900 font-medium mb-6 transition-colors"
        >
          <span>←</span> Back to Jobs
        </Link>

        <div className="bg-white border border-zinc-200 rounded-xl p-6 md:p-8 shadow-xs">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-2.5 flex-wrap mb-3">
              <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 tracking-tight">
                {job.title}
              </h1>
              {platformName && (
                <span
                  className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border ${getPlatformBadgeStyle(platformName)}`}
                >
                  {platformName}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600 font-medium">
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                {job.company}
              </span>
              {job.location && (
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  {job.location}
                </span>
              )}
              {job.workMode && (
                <span className="flex items-center gap-1.5">
                  <span className="text-xs px-2.5 py-1 bg-zinc-100 text-zinc-700 rounded-full border border-zinc-200 font-normal">
                    {job.workMode}
                  </span>
                </span>
              )}
            </div>

            {/* Salary & Posted Date */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-500 mt-3">
              {job.salarySnippet && (
                <span className="font-semibold text-zinc-800 flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {job.salarySnippet}
                </span>
              )}
              {formatDate(job.postedAt) && (
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  Posted {formatDate(job.postedAt)}
                </span>
              )}
            </div>
          </div>

          {/* Match Score */}
          {job.matchScore !== undefined && (
            <div className="mb-6 p-4 bg-zinc-50 rounded-lg border border-zinc-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-zinc-700">Match Score</span>
                <span className="text-lg font-bold text-zinc-900">{job.matchScore}%</span>
              </div>
              <div className="w-full h-2 bg-zinc-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-zinc-900 rounded-full transition-all duration-500"
                  style={{ width: `${job.matchScore}%` }}
                />
              </div>
              {job.matchedSkills && job.matchedSkills.length > 0 && (
                <p className="text-xs text-zinc-600 mt-2">
                  Matched skills: <span className="font-medium">{job.matchedSkills.join(', ')}</span>
                </p>
              )}
              {job.missingSkills && job.missingSkills.length > 0 && (
                <p className="text-xs text-zinc-500 mt-1">
                  Missing skills: <span className="font-medium">{job.missingSkills.slice(0, 5).join(', ')}{job.missingSkills.length > 5 ? '...' : ''}</span>
                </p>
              )}
            </div>
          )}

          {/* Description */}
          {job.description && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-zinc-900 mb-3">Job Description</h2>
              <div className="prose prose-zinc max-w-none text-sm text-zinc-600 leading-relaxed">
                <p>{job.description}</p>
              </div>
            </div>
          )}

          {/* Required Skills */}
          {job.requiredSkills && job.requiredSkills.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-zinc-900 mb-3">Required Skills</h2>
              <div className="flex flex-wrap gap-2">
                {job.requiredSkills.map((skill) => (
                  <span
                    key={skill}
                    className="px-3 py-1 text-sm bg-zinc-100 text-zinc-700 rounded-lg border border-zinc-200"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Matched Skills */}
          {job.matchedSkills && job.matchedSkills.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-zinc-900 mb-3 flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Your Matched Skills
              </h2>
              <div className="flex flex-wrap gap-2">
                {job.matchedSkills.map((skill) => (
                  <span
                    key={skill}
                    className="px-3 py-1 text-sm bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Apply Button */}
          <div className="pt-6 border-t border-zinc-200">
            <a
              href={applyLink}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm hover:shadow-md active:scale-[0.98]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              Apply on {platformName}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}