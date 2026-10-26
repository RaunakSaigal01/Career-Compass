'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import JobCard, { JobItem, deduplicateJobsList } from './jobs/components/JobCard';

type Resume = {
  _id: string;
  originalName: string;
  status: 'pending' | 'parsed' | 'failed';
  createdAt: string;
  parsedProfile?: { skills?: string[]; name?: string };
};

type Profile = {
  name?: string;
  preferredRoles?: string[];
  preferredLocations?: string[];
  masterSkills?: string[];
  primaryResumeId?: string;
};

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

function getSkillGaps(jobs: JobItem[], skills: string[]) {
  const owned = new Set(skills.map((skill) => skill.toLowerCase().trim()));
  const counts = new Map<string, number>();
  for (const job of jobs) {
    for (const skill of job.missingSkills ?? []) {
      const key = skill.trim();
      if (key && !owned.has(key.toLowerCase())) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([skill, count]) => ({ skill, count }));
}

export default function DashboardPage() {
  const router = useRouter();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [profile, setProfile] = useState<Profile>({});
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingSelection, setSavingSelection] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const token = () => localStorage.getItem('accessToken') ?? '';

  const loadRecommendations = useCallback(async (authToken: string) => {
    setJobsLoading(true);
    try {
      const response = await fetch(`${API_URL}/jobs/recommendations`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error('Jobs are temporarily unavailable.');
      const data = await response.json();
      const raw = Array.isArray(data) ? data : data?.jobs ?? [];
      setJobs(deduplicateJobsList(raw));
    } catch {
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    const authToken = token();
    if (!authToken) {
      router.replace('/');
      return;
    }
    try {
      const [resumeResponse, profileResponse] = await Promise.all([
        fetch(`${API_URL}/resumes`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${API_URL}/users/profile`, { headers: { Authorization: `Bearer ${authToken}` } }),
      ]);
      if (resumeResponse.status === 401 || profileResponse.status === 401) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        router.replace('/');
        return;
      }
      const resumeList: Resume[] = resumeResponse.ok ? await resumeResponse.json() : [];
      const userProfile: Profile = profileResponse.ok ? await profileResponse.json() : {};
      setResumes(resumeList);
      setProfile(userProfile);
      const initialResume = userProfile.primaryResumeId && resumeList.some((item) => item._id === userProfile.primaryResumeId)
        ? userProfile.primaryResumeId
        : resumeList[0]?._id ?? '';
      setSelectedResumeId(initialResume);
      setSelectedRole(userProfile.preferredRoles?.[0] ?? '');
      if (!userProfile.primaryResumeId && initialResume) {
        await fetch(`${API_URL}/users/profile`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ primaryResumeId: initialResume }),
        });
      }
      const hasContext = resumeList.length > 0 || (userProfile.preferredRoles?.length ?? 0) > 0;
      if (hasContext) await loadRecommendations(authToken);
    } catch {
      setError('We could not load your dashboard. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [loadRecommendations, router]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const selectedResume = resumes.find((resume) => resume._id === selectedResumeId);
  const userSkills = useMemo(() => [
    ...(profile.masterSkills ?? []),
    ...(selectedResume?.parsedProfile?.skills ?? []),
  ], [profile.masterSkills, selectedResume]);
  const gaps = useMemo(() => getSkillGaps(jobs, userSkills), [jobs, userSkills]);
  const roleOptions = profile.preferredRoles ?? [];

  async function saveSelection(resumeId: string, role: string) {
    const authToken = token();
    setSavingSelection(true);
    setNotice('');
    setError('');
    try {
      const payload: Record<string, unknown> = { primaryResumeId: resumeId || '', preferredRoles: role ? [role] : [] };
      const response = await fetch(`${API_URL}/users/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Could not save your dashboard selections.');
      const updated = await response.json();
      setProfile((current) => ({ ...current, ...updated }));
      setNotice('Your recommendations are updated.');
      if (resumeId || role) await loadRecommendations(authToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your selection.');
    } finally {
      setSavingSelection(false);
    }
  }

  async function uploadResume() {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const createdResponse = await fetch(`${API_URL}/resumes`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body,
      });
      const created = await createdResponse.json().catch(() => ({}));
      if (!createdResponse.ok) throw new Error(created.message ?? 'Resume upload failed.');
      const parseResponse = await fetch(`${API_URL}/resumes/${created._id}/parse`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}` },
      });
      if (!parseResponse.ok) throw new Error('Resume uploaded, but we could not extract its profile.');
      const parsed: Resume = await parseResponse.json();
      setFile(null);
      await loadDashboard();
      setSelectedResumeId(parsed._id);
      await saveSelection(parsed._id, selectedRole);
      router.push(`/dashboard/resume/${parsed._id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resume upload failed.');
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <main className="career-page"><div className="career-container"><p className="career-muted">Loading your career overview…</p></div></main>;

  return (
    <main className="career-page">
      <div className="career-container">
        <header className="career-topbar">
          <Link className="brand" href="/dashboard"><span className="brand-mark">c/</span><span>career compass</span></Link>
          <nav className="career-nav" aria-label="Dashboard navigation">
            <Link className="active" href="/dashboard">Overview</Link>
            <Link href="/dashboard/jobs">Jobs</Link>
            <Link href="/dashboard/learning">Skills &amp; courses</Link>
            <Link href="/dashboard/studies">Higher studies</Link>
            <Link href="/dashboard/profile">Profile</Link>
          </nav>
          <button className="career-link-button" onClick={() => { localStorage.removeItem('accessToken'); localStorage.removeItem('user'); router.replace('/'); }} type="button">Sign out</button>
        </header>

        <section className="career-welcome">
          <div>
            <p className="career-eyebrow">YOUR CAREER, IN FOCUS</p>
            <h1>Make your next move count.</h1>
            <p>One clear view of roles to explore, skills to build, and study paths to consider.</p>
          </div>
          <div className="career-context">
            <label htmlFor="resume-select">Resume</label>
            <select id="resume-select" value={selectedResumeId} onChange={(e) => { setSelectedResumeId(e.target.value); void saveSelection(e.target.value, selectedRole); }}>
              <option value="">Choose a resume</option>
              {resumes.map((resume) => <option key={resume._id} value={resume._id}>{resume.originalName}</option>)}
            </select>
            <label htmlFor="role-select">Target role</label>
            <select id="role-select" value={selectedRole} onChange={(e) => { setSelectedRole(e.target.value); void saveSelection(selectedResumeId, e.target.value); }}>
              <option value="">Choose from your profile</option>
              {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
            <Link href="/dashboard/profile" className="career-inline-link">Manage roles and preferences →</Link>
            {savingSelection && <span className="career-muted" role="status">Saving selection…</span>}
          </div>
        </section>

        {(error || notice) && <p className={error ? 'career-alert' : 'career-success'} role={error ? 'alert' : 'status'}>{error || notice}</p>}

        <section className="career-upload-strip" aria-label="Resume upload">
          <div><span className="career-kicker">PROFILE</span><h2>{selectedResume ? selectedResume.originalName : 'Start with your resume'}</h2><p>{selectedResume ? `Resume status: ${selectedResume.status}. Review extracted details any time.` : 'Upload a PDF or DOCX to get personalized role and skill recommendations.'}</p></div>
          <div className="career-upload-actions">
            <label className="career-file-button">{file ? file.name : 'Choose resume'}<input type="file" accept=".pdf,.docx" onChange={(e) => { const next = e.target.files?.[0] ?? null; if (next && next.size > 5 * 1024 * 1024) { setError('Please choose a file smaller than 5 MB.'); setFile(null); } else { setError(''); setFile(next); } }} /></label>
            <button className="career-button" type="button" disabled={!file || uploading} onClick={() => void uploadResume()}>{uploading ? 'Uploading…' : 'Upload new resume'} <span aria-hidden="true">→</span></button>
            {selectedResume && <Link className="career-inline-link" href={`/dashboard/resume/${selectedResume._id}`}>Review profile</Link>}
          </div>
        </section>

        <div className="career-section-heading"><div><p className="career-eyebrow">A QUICK READ</p><h2>Your opportunity snapshot</h2></div></div>
        <section className="career-metrics" aria-label="Recommendation summary">
          <article><span className="career-metric-label">Role matches</span><strong>{jobsLoading ? '…' : jobs.length}</strong><span>based on your profile</span></article>
          <article><span className="career-metric-label">Skills to explore</span><strong>{gaps.length}</strong><span>most requested by matched jobs</span></article>
          <article><span className="career-metric-label">Resume</span><strong>{selectedResume ? selectedResume.status === 'parsed' ? 'Ready' : 'In progress' : 'Add one'}</strong><span>{selectedResume ? 'selected for recommendations' : 'to personalize your dashboard'}</span></article>
        </section>

        <section className="career-content-grid">
          <div className="career-panel career-jobs-panel">
            <div className="career-panel-heading"><div><p className="career-eyebrow">OPPORTUNITIES</p><h2>Jobs for your next step</h2></div><Link className="career-inline-link" href="/dashboard/jobs">Explore all jobs →</Link></div>
            {!selectedResume && !selectedRole ? <div className="career-empty"><h3>Choose a resume or target role</h3><p>We’ll use either one to find relevant opportunities. Add a role in your profile if you haven’t yet.</p><Link className="career-button" href="/dashboard/profile">Set target roles →</Link></div> : jobsLoading ? <div className="career-skeleton" aria-label="Loading job recommendations"><i/><i/><i/></div> : jobs.length ? <div className="career-job-list">{jobs.slice(0, 3).map((job, index) => <JobCard key={job.externalId || job._id || `${job.company}-${job.title}-${index}`} job={job}/>)}</div> : <div className="career-empty"><h3>No matches found yet</h3><p>Try another target role or update your location preferences.</p><Link className="career-inline-link" href="/dashboard/profile">Update preferences →</Link></div>}
          </div>

          <div className="career-side-stack">
            <section className="career-panel">
              <div className="career-panel-heading"><div><p className="career-eyebrow">GROWTH AREAS</p><h2>Top skill gaps</h2></div><Link className="career-inline-link" href="/dashboard/learning">See learning plan →</Link></div>
              {gaps.length ? <ol className="career-gap-list">{gaps.map(({ skill, count }, index) => <li key={skill}><span className="career-gap-number">0{index + 1}</span><span><strong>{skill}</strong><small>Appears in {count} matched {count === 1 ? 'job' : 'jobs'}</small></span><a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${skill} full course`)}`} target="_blank" rel="noreferrer">Watch ↗</a></li>)}</ol> : <div className="career-empty compact"><p>{selectedResume ? 'Skill gaps will appear as we find jobs with listed requirements.' : 'Add a resume or target role to see skills worth building.'}</p></div>}
            </section>
            <section className="career-study-callout"><p className="career-eyebrow">LOOKING FURTHER AHEAD?</p><h2>Explore higher study options</h2><p>See possible exams, study paths, and ways to begin a university shortlist based on your background.</p><Link href="/dashboard/studies">Explore study guidance <span aria-hidden="true">→</span></Link></section>
          </div>
        </section>

        <footer className="career-footer"><span>Recommendations are starting points. Review job requirements and official exam or university guidance before making decisions.</span><Link href="/dashboard/profile">Your profile →</Link></footer>
      </div>
    </main>
  );
}
