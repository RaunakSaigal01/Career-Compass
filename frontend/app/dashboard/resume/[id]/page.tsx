'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface StoredUser {
  id: string;
  email: string;
}

interface ParsedBasics {
  emails: string[];
  phones: string[];
  urls: string[];
  linkedin?: string;
  github?: string;
}

interface ParsedSections {
  summary: string;
  education: string;
  experience: string;
  projects: string;
  skills: string;
  certifications: string;
}

interface ParsedProfile {
  name?: string;
  basics?: ParsedBasics;
  sections?: ParsedSections;
  skills?: string[];
  rawText?: string;
}

interface ResumeDoc {
  _id: string;
  originalName: string;
  mimeType: string;
  status: 'pending' | 'parsed' | 'failed';
  parsedProfile?: ParsedProfile;
  rawText?: string;
  createdAt: string;
}

const API_URL = 'http://localhost:3001';

export default function ResumeReviewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [user, setUser] = useState<StoredUser | null>(null);
  const [resume, setResume] = useState<ResumeDoc | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [github, setGithub] = useState('');
  const [skills, setSkills] = useState('');
  const [summary, setSummary] = useState('');
  const [education, setEducation] = useState('');
  const [experience, setExperience] = useState('');
  const [projects, setProjects] = useState('');
  const [certifications, setCertifications] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState('');
  const [error, setError] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [isScoring, setIsScoring] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const rawUser = localStorage.getItem('user');

    if (!token || !rawUser) {
      router.replace('/');
      return;
    }

    try {
      setUser(JSON.parse(rawUser) as StoredUser);
    } catch {
      localStorage.removeItem('user');
      router.replace('/');
      return;
    }

    fetch(`${API_URL}/resumes/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (res.status === 401) {
          localStorage.clear();
          router.replace('/');
          return;
        }
        if (!res.ok) {
          throw new Error('Could not load this resume.');
        }
        const doc = (await res.json()) as ResumeDoc;
        setResume(doc);

        // Pre-fill the form from the parsed profile (if any)
        const p = doc.parsedProfile;
        setName(p?.name ?? '');
        setEmail(p?.basics?.emails?.[0] ?? '');
        setPhone(p?.basics?.phones?.[0] ?? '');
        setLinkedin(p?.basics?.linkedin ?? '');
        setGithub(p?.basics?.github ?? '');
        setSkills((p?.skills ?? []).join(', '));
        setSummary(p?.sections?.summary ?? '');
        setEducation(p?.sections?.education ?? '');
        setExperience(p?.sections?.experience ?? '');
        setProjects(p?.sections?.projects ?? '');
        setCertifications(p?.sections?.certifications ?? '');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, [id, router]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!resume) return;

    setIsSaving(true);
    setError('');

    const token = localStorage.getItem('accessToken');

    const profile: ParsedProfile = {
      name: name.trim() || undefined,
      basics: {
        emails: email ? [email] : [],
        phones: phone ? [phone] : [],
        urls: [],
        linkedin: linkedin || undefined,
        github: github || undefined,
      },
      skills: skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      sections: {
        summary,
        education,
        experience,
        projects,
        skills,
        certifications,
      },
      rawText: resume.rawText ?? '',
    };

    try {
      const res = await fetch(`${API_URL}/resumes/${id}/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          profile,
          jobDescription: jobDescription.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Could not save your profile.');
      }

      const updated = (await res.json()) as ResumeDoc;
      setResume(updated);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setIsSaving(false);
    }
  }
  async function handleScore() {
    if (!resume) return;

    setIsScoring(true);
    setError('');

    const token = localStorage.getItem('accessToken');

    try {
      const res = await fetch(`${API_URL}/resumes/${resume._id}/score`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jobDescription: jobDescription.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Could not score your resume.');
      }

      router.push(`/dashboard/resume/${resume._id}/analysis`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not score your resume.',
      );
    } finally {
      setIsScoring(false);
    }
  }
  async function handleDelete() {
    if (!resume) return;
    if (!confirm('Delete this resume? This cannot be undone.')) return;

    const token = localStorage.getItem('accessToken');
    await fetch(`${API_URL}/resumes/${resume._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);

    router.push('/dashboard');
  }

  function handleSignOut() {
    localStorage.clear();
    router.replace('/');
  }

  if (isLoading) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <p>Loading…</p>
        </section>
      </main>
    );
  }

  if (!resume) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <h1>Resume not found</h1>
          {error && <p className="notice" role="alert">{error}</p>}
          <button className="primary-button" type="button" onClick={() => router.push('/dashboard')}>
            Back to dashboard
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <header>
          <a className="brand" href="/dashboard">
            <span className="brand-mark" aria-hidden="true">c/</span>
            <span>career compass</span>
          </a>
          <p className="eyebrow">REVIEW YOUR PARSED PROFILE</p>
          <h1>Make sure these details are correct.</h1>
          <p className="intro">
            We extracted this from <strong>{resume.originalName}</strong>.
            Correct anything that looks wrong before we score it.
          </p>
          {resume.status === 'failed' && (
            <p className="notice" role="alert">
              We couldn&rsquo;t read the text in this file. It may be image-only or
              password-protected. You can still fill in the fields below by hand.
            </p>
          )}
        </header>

        <form onSubmit={handleSave}>
          <label htmlFor="name">Full name</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
          />

          <div className="label-row">
            <label htmlFor="email">Email</label>
          </div>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />

          <div className="label-row">
            <label htmlFor="phone">Phone</label>
          </div>
          <input
            id="phone"
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 123 4567"
          />

          <div className="label-row">
            <label htmlFor="linkedin">LinkedIn</label>
          </div>
          <input
            id="linkedin"
            type="text"
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            placeholder="linkedin.com/in/your-handle"
          />

          <div className="label-row">
            <label htmlFor="github">GitHub</label>
          </div>
          <input
            id="github"
            type="text"
            value={github}
            onChange={(e) => setGithub(e.target.value)}
            placeholder="github.com/your-handle"
          />

          <div className="label-row">
            <label htmlFor="skills">Skills (comma-separated)</label>
          </div>
          <textarea
            id="skills"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            placeholder="React, TypeScript, Node.js, PostgreSQL"
            rows={3}
          />

          <div className="label-row">
            <label htmlFor="summary">Summary</label>
          </div>
          <textarea
            id="summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="A short professional summary…"
            rows={4}
          />

          <div className="label-row">
            <label htmlFor="experience">Experience</label>
          </div>
          <textarea
            id="experience"
            value={experience}
            onChange={(e) => setExperience(e.target.value)}
            placeholder="One role per entry, with measurable outcomes…"
            rows={6}
          />

          <div className="label-row">
            <label htmlFor="education">Education</label>
          </div>
          <textarea
            id="education"
            value={education}
            onChange={(e) => setEducation(e.target.value)}
            placeholder="Degree, institution, year…"
            rows={3}
          />

          <div className="label-row">
            <label htmlFor="projects">Projects</label>
          </div>
          <textarea
            id="projects"
            value={projects}
            onChange={(e) => setProjects(e.target.value)}
            placeholder="Name, what it does, your contribution…"
            rows={4}
          />

          <div className="label-row">
            <label htmlFor="certifications">Certifications</label>
          </div>
          <textarea
            id="certifications"
            value={certifications}
            onChange={(e) => setCertifications(e.target.value)}
            placeholder="AWS Certified Developer, 2024…"
            rows={3}
          />

          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}

          {savedAt && (
            <p className="notice" role="status">
              Saved at {savedAt}
            </p>
          )}
          <div className="label-row">
            <label htmlFor="job-description">Target job description (optional)</label>
          </div>
          <textarea
            id="job-description"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Paste the job description here to receive role-specific feedback…"
            rows={8}
          />

          <button
            className="primary-button"
            type="button"
            onClick={handleScore}
            disabled={isSaving || isScoring}
          >
            {isScoring ? 'Scoring…' : 'Score my resume'}
            <span aria-hidden="true">→</span>
          </button>
          <button className="primary-button" type="submit" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save profile'}
            <span aria-hidden="true">→</span>
          </button>
        </form>

        <footer className="dashboard-footer">
          <button className="text-button" type="button" onClick={handleDelete}>
            Delete resume
          </button>
          <span>•</span>
          <button className="text-button" type="button" onClick={handleSignOut}>
            Sign out
          </button>
        </footer>
      </section>
    </main>
  );
}