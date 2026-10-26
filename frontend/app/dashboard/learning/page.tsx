'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { JobItem } from '../jobs/components/JobCard';

type Profile = { preferredRoles?: string[]; masterSkills?: string[]; primaryResumeId?: string };
type Resume = { _id: string; parsedProfile?: { skills?: string[] } };
type Gap = { skill: string; count: number };
type CourseItem = {
  type?: 'video' | 'playlist';
  language?: 'English' | 'Hindi';
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  watchUrl: string;
  viewCount?: number;
  likeCount?: number;
  itemCount?: number;
};
type CourseRecommendations = { videos: CourseItem[]; playlists: CourseItem[] };
const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function findGaps(jobs: JobItem[], skills: string[]): Gap[] {
  const known = new Set(skills.map((skill) => skill.toLowerCase().trim()));
  const tally = new Map<string, number>();
  jobs.forEach((job) => (job.missingSkills ?? []).forEach((skill) => {
    if (skill.trim() && !known.has(skill.toLowerCase().trim())) tally.set(skill, (tally.get(skill) ?? 0) + 1);
  }));
  return [...tally].map(([skill, count]) => ({ skill, count })).sort((a, b) => b.count - a.count).slice(0, 5);
}

export default function LearningPage() {
  const router = useRouter();
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [coursesBySkill, setCoursesBySkill] = useState<Record<string, CourseRecommendations>>({});
  const [coursesLoading, setCoursesLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.replace('/'); return; }
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${API_URL}/users/profile`, { headers }).then((r) => r.ok ? r.json() : {}),
      fetch(`${API_URL}/jobs/recommendations`, { headers }).then((r) => r.ok ? r.json() : []),
      fetch(`${API_URL}/resumes`, { headers }).then((r) => r.ok ? r.json() : []),
    ]).then(([profile, jobData, resumes]: [Profile, JobItem[] | { jobs?: JobItem[] }, Resume[]]) => {
      const resume = resumes.find((item) => item._id === profile.primaryResumeId);
      const jobList = Array.isArray(jobData) ? jobData : jobData?.jobs ?? [];
      const nextGaps = findGaps(jobList, [...(profile.masterSkills ?? []), ...(resume?.parsedProfile?.skills ?? [])]);
      setRoles(profile.preferredRoles ?? []);
      setGaps(nextGaps);
      const topSkills = nextGaps.map((gap) => gap.skill);
      if (topSkills.length) {
        setCoursesLoading(true);
        const requestCourses = async (skills: string[]) => {
          const response = await fetch(`${API_URL}/courses/youtube`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ skills }),
          });
          if (!response.ok) {
            const error = new Error('Course recommendations are unavailable.') as Error & { status?: number };
            error.status = response.status;
            throw error;
          }
          return response.json() as Promise<{ skill: string; videos?: CourseItem[]; playlists?: CourseItem[] }[]>;
        };
        requestCourses(topSkills).catch(async (error: Error & { status?: number }) => {
          // Older backend processes may still enforce the previous three-skill request limit.
          if (error.status !== 400 || topSkills.length <= 3) throw error;
          const batches = [topSkills.slice(0, 3), topSkills.slice(3)];
          const results = await Promise.all(batches.map(requestCourses));
          return results.flat();
        }).then((results) => {
          setCoursesBySkill(Object.fromEntries(results.map((item) => [item.skill.toLowerCase(), {
            videos: item.videos ?? [],
            playlists: item.playlists ?? [],
          }])));
        }).catch(() => {
          // Keep the search-link fallback available when YouTube API results cannot load.
        }).finally(() => setCoursesLoading(false));
      }
    }).catch(() => setError('Could not load learning recommendations. Try again later.')).finally(() => setLoading(false));
  }, [router]);

  const searchUrl = (skill: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${skill} full course tutorial`)}`;
  const focusRole = useMemo(() => roles[0] ?? 'your target role', [roles]);

  return <main className="career-page"><div className="career-container">
    <header className="career-topbar"><Link className="brand" href="/dashboard"><span className="brand-mark">c/</span><span>career compass</span></Link><nav className="career-nav" aria-label="Dashboard navigation"><Link href="/dashboard">Overview</Link><Link href="/dashboard/jobs">Jobs</Link><Link className="active" href="/dashboard/learning">Skills &amp; courses</Link><Link href="/dashboard/studies">Higher studies</Link><Link href="/dashboard/profile">Profile</Link></nav></header>
    <section className="career-page-heading"><p className="career-eyebrow">LEARNING PLAN · {focusRole.toUpperCase()}</p><h1>Build the skills your next role asks for.</h1><p>Your five most frequent skill gaps, with relevant YouTube videos and playlists ranked using relevance and available popularity signals.</p></section>
    {error && <p className="career-alert" role="alert">{error}</p>}
    {loading ? <div className="career-skeleton"><i/><i/><i/></div> : gaps.length ? <section className="career-learning-list" aria-label="Recommended video courses">{gaps.map((gap, index) => {
      const recommendations = coursesBySkill[gap.skill.toLowerCase()] ?? { videos: [], playlists: [] };
      const hasRecommendations = recommendations.videos.length > 0 || recommendations.playlists.length > 0;
      return <article className="career-learning-item" key={gap.skill}><div className="career-learning-index">{String(index + 1).padStart(2, '0')}</div><div className="career-learning-copy"><span className="career-kicker">{gap.count} MATCHED {gap.count === 1 ? 'JOB' : 'JOBS'}</span><h2>{gap.skill}</h2><p>Recommended because this skill is listed in {gap.count} of your current job matches. Confirm whether you already have this skill before treating it as a gap.</p>
        {coursesLoading && <div className="career-course-meta"><span>Finding relevant videos and playlists…</span></div>}
        {recommendations.videos.length > 0 && <><h3 className="career-course-subheading">Videos</h3><div className="career-video-grid">{recommendations.videos.map((video) => <a className="career-video-card" href={video.watchUrl} target="_blank" rel="noreferrer" key={video.watchUrl}><img src={video.thumbnailUrl} alt="" loading="lazy"/><span className="career-video-title">{video.title}</span><span className="career-video-channel">{video.channelTitle}</span><span className="career-video-stats">{video.language ? `${video.language} · ` : ''}{video.viewCount !== undefined ? `${formatCount(video.viewCount)} views` : ''}{video.likeCount !== undefined ? ` · ${formatCount(video.likeCount)} likes` : ''}</span></a>)}</div></>}
        {recommendations.playlists.length > 0 && <><h3 className="career-course-subheading">Playlists</h3><div className="career-video-grid">{recommendations.playlists.map((playlist) => <a className="career-video-card" href={playlist.watchUrl} target="_blank" rel="noreferrer" key={playlist.watchUrl}><img src={playlist.thumbnailUrl} alt="" loading="lazy"/><span className="career-video-title">{playlist.title}</span><span className="career-video-channel">{playlist.channelTitle}</span><span className="career-video-stats">{playlist.language ? `${playlist.language} · ` : ''}{playlist.itemCount !== undefined ? `${formatCount(playlist.itemCount)} lessons` : 'YouTube playlist'}</span></a>)}</div></>}
      </div>{!hasRecommendations && !coursesLoading && <a className="career-button" href={searchUrl(gap.skill)} target="_blank" rel="noreferrer">Browse YouTube <span aria-hidden="true">↗</span></a>}</article>;
    })}</section> : <section className="career-empty career-empty-large"><h2>No skill gaps to show yet</h2><p>Upload and select a resume, then choose a target role. We’ll compare your skills with the requirements in your job matches.</p><Link className="career-button" href="/dashboard">Return to overview →</Link></section>}
    <p className="career-source-note">Course results are search suggestions, not endorsements. Check the instructor, syllabus, and recency before enrolling.</p>
  </div></main>;
}
