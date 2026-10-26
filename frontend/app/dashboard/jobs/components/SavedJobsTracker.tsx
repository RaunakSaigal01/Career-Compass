'use client';

import { useState } from 'react';

interface SavedJobItem {
  _id: string;
  jobId: string;
  title: string;
  company: string;
  location: string;
  workMode?: string;
  salarySnippet?: string;
  platform: string;
  applyUrl: string;
  matchScore: number;
  matchedSkills?: string[];
  missingSkills?: string[];
  status: 'saved' | 'applied' | 'interviewing' | 'rejected' | 'offer';
  notes?: string;
  appliedDate?: string | Date;
}

interface SavedJobsTrackerProps {
  jobs: SavedJobItem[];
  onUpdate?: () => void;
}

const API_URL = 'http://localhost:3001';

export default function SavedJobsTracker({ jobs, onUpdate }: SavedJobsTrackerProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const filteredJobs = jobs.filter(
    (job) => statusFilter === 'all' || job.status === statusFilter,
  );

  const handleStatusChange = async (id: string, newStatus: string) => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    setUpdatingId(id);
    try {
      const res = await fetch(`${API_URL}/jobs/saved/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        onUpdate?.();
      }
    } catch (error) {
      console.error('Error updating status:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remove this job from your tracked applications?')) {
      return;
    }
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/jobs/saved/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        onUpdate?.();
      }
    } catch (error) {
      console.error('Error deleting job:', error);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'saved':
        return 'bg-zinc-100 text-zinc-700 border-zinc-200';
      case 'applied':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'interviewing':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'offer':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'rejected':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      default:
        return 'bg-zinc-100 text-zinc-700 border-zinc-200';
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-1.5 items-center pb-2 border-b border-zinc-200 text-xs font-semibold">
        {[
          { key: 'all', label: 'All', count: jobs.length },
          { key: 'saved', label: 'Saved', count: jobs.filter((j) => j.status === 'saved').length },
          { key: 'applied', label: 'Applied', count: jobs.filter((j) => j.status === 'applied').length },
          { key: 'interviewing', label: 'Interviewing', count: jobs.filter((j) => j.status === 'interviewing').length },
          { key: 'offer', label: 'Offer', count: jobs.filter((j) => j.status === 'offer').length },
          { key: 'rejected', label: 'Rejected', count: jobs.filter((j) => j.status === 'rejected').length },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-lg border transition-all ${
              statusFilter === tab.key
                ? 'bg-[#18181b] text-white border-[#18181b]'
                : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Jobs List */}
      {filteredJobs.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-xl p-12 text-center space-y-2">
          <p className="text-sm font-semibold text-zinc-800">No applications in this category.</p>
          <p className="text-xs text-zinc-500">
            Bookmark listings from the Recommended Jobs tab to track your application pipeline.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredJobs.map((job) => (
            <div
              key={job._id}
              className="bg-white border border-[#e4e4e7] rounded-xl p-5 hover:border-zinc-400 hover:shadow-xs transition-all duration-150"
            >
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                {/* Left: Info */}
                <div className="flex-1 min-w-0 space-y-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-semibold text-[#18181b] tracking-tight">
                        {job.title}
                      </h3>
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-zinc-100 text-zinc-700 border border-zinc-200">
                        {job.platform}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 text-xs font-bold rounded-full border uppercase tracking-wider ${getStatusBadge(
                          job.status,
                        )}`}
                      >
                        {job.status}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-zinc-600 mt-0.5">{job.company}</p>
                  </div>

                  {/* Attributes */}
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-100 text-zinc-800 rounded-md font-semibold border border-zinc-200">
                      <span>💰</span>
                      <span>{job.salarySnippet || 'Competitive'}</span>
                    </span>

                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-100 text-zinc-700 rounded-md border border-zinc-200">
                      <span>📍</span>
                      <span>{job.location}</span>
                    </span>

                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-100 text-zinc-700 rounded-md border border-zinc-200 font-medium">
                      <span>🏢</span>
                      <span>{job.workMode || 'On-Site'}</span>
                    </span>

                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-md font-semibold border border-emerald-200">
                      <span>🎯</span>
                      <span>{job.matchScore}% Match</span>
                    </span>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex md:flex-col items-center md:items-end justify-end gap-2 pt-2 md:pt-0 shrink-0 border-t md:border-t-0 border-zinc-100">
                  <a
                    href={job.applyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-[#18181b] hover:bg-[#059669] text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                  >
                    <span>Apply Listing</span>
                    <span>↗</span>
                  </a>

                  {/* Status Dropdown */}
                  <div className="flex items-center gap-1.5">
                    <select
                      value={job.status}
                      disabled={updatingId === job._id}
                      onChange={(e) => handleStatusChange(job._id, e.target.value)}
                      className="text-xs bg-white border border-zinc-300 rounded-lg px-2 py-1.5 font-medium text-zinc-800 focus:outline-none focus:border-[#059669]"
                    >
                      <option value="saved">Saved</option>
                      <option value="applied">Applied</option>
                      <option value="interviewing">Interviewing</option>
                      <option value="offer">Offer</option>
                      <option value="rejected">Rejected</option>
                    </select>

                    <button
                      onClick={() => handleDelete(job._id)}
                      className="p-1.5 text-xs text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-md border border-transparent transition-colors"
                      title="Remove from tracker"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}