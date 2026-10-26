'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import JobCard, { JobItem, deduplicateJobsList } from './components/JobCard';
import JobCardSkeleton from './components/JobCardSkeleton';

const API_URL = 'http://localhost:3001';

export default function JobsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [savedJobs, setSavedJobs] = useState<JobItem[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'saved'>('all');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [workModeFilter, setWorkModeFilter] = useState<string>('All');
  const [hasContext, setHasContext] = useState(false);

  const fetchInitialData = useCallback(async () => {
    const token = localStorage.getItem('accessToken');
    const rawUser = localStorage.getItem('user');

    if (!token || !rawUser) {
      router.replace('/');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const headers = { Authorization: `Bearer ${token}` };

      const [resProfile, resSaved] = await Promise.all([
        fetch(`${API_URL}/users/profile`, { headers }),
        fetch(`${API_URL}/jobs/saved`, { headers }),
      ]);

      if (resProfile.status === 401 || resSaved.status === 401) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        router.replace('/');
        return;
      }

      const profile = resProfile.ok ? await resProfile.json() : {};
      const hasRecommendationsContext = Boolean(profile.primaryResumeId || profile.preferredRoles?.length);
      setHasContext(hasRecommendationsContext);

      if (hasRecommendationsContext) {
        const resRec = await fetch(`${API_URL}/jobs/recommendations`, { headers });
        if (!resRec.ok) throw new Error(`Failed to load jobs (${resRec.status})`);
        const data = await resRec.json();
        const rawList: JobItem[] = Array.isArray(data) ? data : data?.jobs || [];
        // Deduplicate jobs in frontend defense
        const dedupedList = deduplicateJobsList(rawList);
        // Sort by postedAt descending (latest 1st)
        const sorted = dedupedList.sort((a, b) => {
          const timeA = a.postedAt ? new Date(a.postedAt).getTime() : 0;
          const timeB = b.postedAt ? new Date(b.postedAt).getTime() : 0;
          return timeB - timeA;
        });
        setJobs(sorted);
      } else {
        setJobs([]);
      }

      if (resSaved.ok) {
        const dataSaved = await resSaved.json();
        const rawSaved = Array.isArray(dataSaved) ? dataSaved : [];
        setSavedJobs(deduplicateJobsList(rawSaved));
      }
    } catch (err: any) {
      console.error('Jobs fetch error:', err);
      setError("We couldn't load jobs right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const getJobKey = (job: JobItem): string => {
    return job.externalId || job.jobId || job._id || `${job.company}-${job.title}`.replace(/\s+/g, '-');
  };

  // Build a Set of saved IDs for O(1) lookup
  const savedJobIds = useMemo(() => {
    return new Set(savedJobs.map(getJobKey));
  }, [savedJobs]);

  // Seamless in-memory bookmarking with zero page refresh / zero skeleton flicker
  const handleToggleSave = async (targetJob: JobItem, willBeSaved: boolean) => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const targetKey = getJobKey(targetJob);
    const platformName = targetJob.platform || targetJob.source || 'Direct';
    const applyLink = targetJob.applyUrl || targetJob.url || '#';

    // 1. Optimistically update local savedJobs state immediately
    if (willBeSaved) {
      setSavedJobs((prev) => {
        const exists = prev.some((j) => getJobKey(j) === targetKey);
        if (exists) return prev;
        return [
          {
            ...targetJob,
            jobId: targetKey,
            platform: platformName,
            applyUrl: applyLink,
          },
          ...prev,
        ];
      });
    } else {
      setSavedJobs((prev) => prev.filter((j) => getJobKey(j) !== targetKey));
    }

    // 2. Persist to backend MongoDB in background
    try {
      if (willBeSaved) {
        const res = await fetch(`${API_URL}/jobs/saved`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            jobId: targetKey,
            title: targetJob.title,
            company: targetJob.company,
            location: targetJob.location || 'India',
            workMode: targetJob.workMode || 'On-Site',
            salarySnippet: targetJob.salarySnippet || '',
            platform: platformName,
            applyUrl: applyLink,
            matchScore: targetJob.matchScore || 85,
            matchedSkills: targetJob.matchedSkills || [],
            missingSkills: targetJob.missingSkills || [],
            status: 'saved',
            description: targetJob.description || '',
            postedAt: targetJob.postedAt || new Date(),
          }),
        });

        if (!res.ok) {
          console.error('Failed to bookmark job on server:', res.status);
        }
      } else {
        await fetch(`${API_URL}/jobs/saved/${encodeURIComponent(targetKey)}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
    } catch (err) {
      console.error('Background save error:', err);
    }
  };

  const displayList = activeTab === 'all' ? jobs : savedJobs;

  // Filter display list by search and workMode
  const filteredJobs = displayList.filter((job) => {
    const matchesSearch =
      searchQuery.trim() === '' ||
      job.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.company?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.location?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesWorkMode =
      workModeFilter === 'All' ||
      (job.workMode || '').toLowerCase() === workModeFilter.toLowerCase();

    return matchesSearch && matchesWorkMode;
  });

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#fafafa]">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-col space-y-6">
          {/* Header & Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 pb-5">
            <div>
              <Link href="/dashboard" className="text-xs font-semibold text-emerald-700 hover:underline">← Career overview</Link>
              <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">
                Job Search &amp; Recommendations
              </h1>
              <p className="text-xs text-zinc-500 mt-1">
                Latest live opportunities sorted by posted date. Bookmark jobs to review and apply anytime.
              </p>
            </div>

            {/* Tab switch */}
            <div className="flex items-center gap-1.5 p-1 bg-zinc-200/70 rounded-lg self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  activeTab === 'all'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                All Jobs ({jobs.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('saved')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  activeTab === 'saved'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                ★ Saved ({savedJobs.length})
              </button>
            </div>
          </div>

          {/* Search & Filter Bar */}
          {!error && !loading && (
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="relative w-full sm:w-80">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by title, company, location…"
                  className="w-full h-9 pl-9 pr-3 text-xs bg-white border border-zinc-200 rounded-md focus:outline-none focus:border-zinc-400"
                />
                <span className="absolute left-3 top-2.5 text-zinc-400 text-xs">🔍</span>
              </div>

              <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs">
                <span className="text-zinc-500 font-medium mr-1">Work Mode:</span>
                {['All', 'Remote', 'Hybrid', 'On-Site'].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setWorkModeFilter(mode)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      workModeFilter === mode
                        ? 'bg-zinc-900 text-white border-zinc-900'
                        : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* State 1: Loading Skeleton (Only during initial fetch) */}
          {loading && (
            <div className="space-y-3">
              <div className="text-xs text-zinc-500 font-medium py-1">Finding latest jobs…</div>
              {[1, 2, 3, 4, 5].map((i) => (
                <JobCardSkeleton key={i} />
              ))}
            </div>
          )}

          {/* State 2: Error State */}
          {!loading && error && (
            <div className="bg-white border border-red-200 rounded-lg p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-zinc-900">{error}</p>
              <button
                onClick={fetchInitialData}
                className="px-4 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-md hover:bg-zinc-800 transition-colors"
              >
                Retry Search
              </button>
            </div>
          )}

          {/* State 3: Empty Results */}
          {!loading && !error && filteredJobs.length === 0 && (
            <div className="bg-white border border-zinc-200 rounded-lg p-12 text-center space-y-2">
              <p className="text-sm font-semibold text-zinc-900">
                {activeTab === 'saved' ? 'No saved jobs yet.' : hasContext ? 'No jobs found for this role.' : 'Choose a resume or target role to see jobs.'}
              </p>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                {activeTab === 'saved'
                  ? 'Click "☆ Save Job" on any card to bookmark it here for later.'
                  : hasContext ? 'Try a different job title in your profile or adjust your search filter.' : 'Recommendations use the selected resume or target role from your overview.'}
              </p>
              {activeTab === 'all' && !hasContext && <Link href="/dashboard" className="text-xs font-semibold text-emerald-700 hover:underline">Go to overview →</Link>}
            </div>
          )}

          {/* State 4: List of Returned Job Cards */}
          {!loading && !error && filteredJobs.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="text-xs text-zinc-500 font-medium">
                Showing {filteredJobs.length} {activeTab === 'saved' ? 'saved' : 'latest'}{' '}
                {filteredJobs.length === 1 ? 'position' : 'positions'}
              </div>
              {filteredJobs.map((job) => {
                const idKey = getJobKey(job);
                const isItemSaved = savedJobIds.has(idKey);

                return (
                  <JobCard
                    key={idKey}
                    job={job}
                    isSaved={isItemSaved}
                    onToggleSave={handleToggleSave}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
