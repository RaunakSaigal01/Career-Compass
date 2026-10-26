'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface UserProfileData {
  name: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  bio: string;
  linkedin: string;
  github: string;
  portfolio: string;
  preferredRoles: string[];
  preferredLocations: string[];
  preferredWorkModes: string[];
  minExpectedSalary: number;
  masterSkills: string[];
}

const API_URL = 'http://localhost:3001';

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfileData>({
    name: '',
    email: '',
    phone: '',
    location: '',
    headline: '',
    bio: '',
    linkedin: '',
    github: '',
    portfolio: '',
    preferredRoles: [],
    preferredLocations: [],
    preferredWorkModes: ['remote', 'hybrid'],
    minExpectedSalary: 0,
    masterSkills: [],
  });

  const [roleInput, setRoleInput] = useState('');
  const [locInput, setLocInput] = useState('');
  const [skillInput, setSkillInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.replace('/');
      return;
    }

    fetch(`${API_URL}/users/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load profile.');
        return res.json();
      })
      .then((data) => setProfile(data))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [router]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError('');

    const token = localStorage.getItem('accessToken');
    try {
      const cleanPayload = {
        name: profile.name,
        phone: profile.phone,
        location: profile.location,
        headline: profile.headline,
        bio: profile.bio,
        linkedin: profile.linkedin,
        github: profile.github,
        portfolio: profile.portfolio,
        preferredRoles: profile.preferredRoles,
        preferredLocations: profile.preferredLocations,
        preferredWorkModes: profile.preferredWorkModes,
        minExpectedSalary: profile.minExpectedSalary,
        masterSkills: profile.masterSkills,
      };

      const res = await fetch(`${API_URL}/users/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(cleanPayload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = Array.isArray(data.message) ? data.message.join(', ') : (data.message ?? 'Could not update profile.');
        throw new Error(msg);
      }
      const updated = await res.json();
      setProfile(updated);
      setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving profile.');
    } finally {
      setIsSaving(false);
    }
  }

  function addRole() {
    if (roleInput.trim() && !profile.preferredRoles.includes(roleInput.trim())) {
      setProfile({ ...profile, preferredRoles: [...profile.preferredRoles, roleInput.trim()] });
      setRoleInput('');
    }
  }

  function removeRole(r: string) {
    setProfile({ ...profile, preferredRoles: profile.preferredRoles.filter((item) => item !== r) });
  }

  function addSkill() {
    if (skillInput.trim() && !profile.masterSkills.includes(skillInput.trim())) {
      setProfile({ ...profile, masterSkills: [...profile.masterSkills, skillInput.trim()] });
      setSkillInput('');
    }
  }

  function removeSkill(s: string) {
    setProfile({ ...profile, masterSkills: profile.masterSkills.filter((item) => item !== s) });
  }

  if (isLoading) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <p className="intro">Loading your profile…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" style={{ maxWidth: '820px' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <Link href="/dashboard" className="text-button">
            ← Back to Dashboard
          </Link>
          <span className="brand">career compass</span>
        </header>

        <h1 style={{ fontSize: '28px' }}>Master Profile & Career Preferences</h1>
        <p className="intro" style={{ maxWidth: '100%' }}>
          This master profile serves as your default identity. Specific resumes can still be tailored individually.
        </p>

        {savedAt && (
          <div className="save-success-banner" role="status">
            <div className="save-success-title">✓ Master profile updated at {savedAt}</div>
          </div>
        )}

        {error && <p className="notice" role="alert">{error}</p>}

        <form onSubmit={handleSave} style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Section 1: Basic Information */}
          <div className="upload-section">
            <h2 className="section-heading" style={{ fontSize: '16px' }}>Personal & Contact Information</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
              <div>
                <label htmlFor="name">Full Name</label>
                <input
                  id="name"
                  type="text"
                  value={profile.name || ''}
                  onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                  placeholder="e.g. Alex Rivera"
                />
              </div>
              <div>
                <label htmlFor="phone">Phone Number</label>
                <input
                  id="phone"
                  type="text"
                  value={profile.phone || ''}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                  placeholder="+1 (555) 000-0000"
                />
              </div>
            </div>

            <div style={{ marginTop: '12px' }}>
              <label htmlFor="headline">Professional Headline</label>
              <input
                id="headline"
                type="text"
                value={profile.headline || ''}
                onChange={(e) => setProfile({ ...profile, headline: e.target.value })}
                placeholder="e.g. Senior Frontend Engineer | React & Next.js"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
              <div>
                <label htmlFor="linkedin">LinkedIn URL</label>
                <input
                  id="linkedin"
                  type="text"
                  value={profile.linkedin || ''}
                  onChange={(e) => setProfile({ ...profile, linkedin: e.target.value })}
                  placeholder="https://linkedin.com/in/..."
                />
              </div>
              <div>
                <label htmlFor="github">GitHub URL</label>
                <input
                  id="github"
                  type="text"
                  value={profile.github || ''}
                  onChange={(e) => setProfile({ ...profile, github: e.target.value })}
                  placeholder="https://github.com/..."
                />
              </div>
            </div>
          </div>

          {/* Section 2: Career & Job Match Preferences */}
          <div className="upload-section">
            <h2 className="section-heading" style={{ fontSize: '16px' }}>Target Job & Career Preferences</h2>
            <p className="section-hint">Used by the Job Matcher and Skill-Gap Recommendation engine.</p>
            
            <div style={{ marginTop: '12px' }}>
              <label>Target Roles</label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input
                  type="text"
                  value={roleInput}
                  onChange={(e) => setRoleInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRole(); } }}
                  placeholder="Add role (e.g. Full Stack Developer) & press Enter"
                />
                <button className="primary-button" type="button" onClick={addRole} style={{ width: 'auto', marginTop: 0 }}>
                  Add
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {profile.preferredRoles?.map((role) => (
                  <span key={role} className="status status-parsed" style={{ cursor: 'pointer' }} onClick={() => removeRole(role)}>
                    {role} ✕
                  </span>
                ))}
              </div>
            </div>

            <div style={{ marginTop: '16px' }}>
              <label>Master Skills Arsenal</label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input
                  type="text"
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                  placeholder="Add master skill (e.g. Docker, TypeScript) & press Enter"
                />
                <button className="primary-button" type="button" onClick={addSkill} style={{ width: 'auto', marginTop: 0 }}>
                  Add
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {profile.masterSkills?.map((skill) => (
                  <span key={skill} className="status status-parsed" style={{ cursor: 'pointer' }} onClick={() => removeSkill(skill)}>
                    {skill} ✕
                  </span>
                ))}
              </div>
            </div>
          </div>

          <button className="primary-button" type="submit" disabled={isSaving}>
            {isSaving ? 'Saving master profile…' : 'Save Master Profile'}
            <span aria-hidden="true">✓</span>
          </button>
        </form>
      </section>
    </main>
  );
}