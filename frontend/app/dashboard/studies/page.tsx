'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  UNIVERSITIES_DATA,
  STUDY_TYPES,
  STUDY_TYPE_LABELS,
  DESTINATIONS_LIST,
  StudyType,
  UniversityRequirement,
} from './data/universities';

type Resume = {
  _id: string;
  parsedProfile?: {
    skills?: string[];
    name?: string;
    sections?: { education?: string; experience?: string; summary?: string };
  };
};

type Profile = {
  primaryResumeId?: string;
  preferredRoles?: string[];
  masterSkills?: string[];
  headline?: string;
};

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const EXAMS = [
  {
    name: 'IELTS',
    label: 'English proficiency',
    description:
      'Widely accepted proof of English ability across UK, Australia, Canada, Europe, and US institutions.',
    url: 'https://ielts.org/',
  },
  {
    name: 'TOEFL iBT',
    label: 'English proficiency',
    description:
      'Standardized English assessment preferred by many US universities and globally recognized graduate programs.',
    url: 'https://www.ets.org/toefl.html',
  },
  {
    name: 'GRE',
    label: 'Graduate admissions',
    description:
      'Required or recommended for MS and PhD quantitative admissions in the US, Germany, and Canada.',
    url: 'https://www.ets.org/gre.html',
  },
  {
    name: 'GMAT Focus',
    label: 'Business & MBA',
    description:
      'Primary assessment for top MBA programs worldwide (Stanford, Harvard, Wharton, LBS, INSEAD, ISB).',
    url: 'https://www.mba.com/exams/gmat-focus-edition',
  },
  {
    name: 'GATE',
    label: 'Engineering & Tech in India',
    description:
      'Gateway exam for M.Tech, MS, and PhD admissions at IISc Bangalore and all IITs/NITs.',
    url: 'https://gate2027.iitm.ac.in/',
  },
  {
    name: 'CAT',
    label: 'Management in India',
    description:
      'Common Admission Test for MBA/PGP entry into IIM Ahmedabad, Bangalore, Calcutta, and top B-schools.',
    url: 'https://iimcat.ac.in/',
  },
];

const DESTINATIONS = [
  {
    country: 'United States',
    detail: 'Explore accredited graduate programs and each university’s admissions requirements.',
    label: 'EducationUSA',
    href: 'https://educationusa.state.gov/',
  },
  {
    country: 'United Kingdom',
    detail: 'Research postgraduate courses, funding options, and student guidance.',
    label: 'Study UK',
    href: 'https://study-uk.britishcouncil.org/',
  },
  {
    country: 'Germany',
    detail: 'Search international degree programs and review language and entry requirements.',
    label: 'DAAD program finder',
    href: 'https://www.daad.de/en/studying-in-germany/universities/all-degree-programmes/',
  },
  {
    country: 'Australia',
    detail: 'Compare courses and learn about application and study requirements.',
    label: 'Study Australia',
    href: 'https://www.studyaustralia.gov.au/',
  },
  {
    country: 'Canada',
    detail: 'Official Government of Canada study portal with university guides and permit criteria.',
    label: 'EduCanada',
    href: 'https://www.educanada.ca/',
  },
  {
    country: 'India',
    detail: 'Explore participating Indian institutions, IITs, IIMs, and higher-education programs.',
    label: 'Study in India',
    href: 'https://studyinindia.gov.in/',
  },
];

function inferField(profile: Profile, resume?: Resume) {
  const text = [
    profile.headline,
    ...(profile.preferredRoles ?? []),
    ...(profile.masterSkills ?? []),
    ...(resume?.parsedProfile?.skills ?? []),
    resume?.parsedProfile?.sections?.education,
    resume?.parsedProfile?.sections?.experience,
  ]
    .join(' ')
    .toLowerCase();
  if (
    /computer|software|data|machine learning|ai|information technology|engineering|developer|programming|cloud/.test(
      text,
    )
  )
    return 'technology, computing, or engineering';
  if (/business|finance|marketing|management|economics|accounting|mba/.test(text))
    return 'business, management, or analytics';
  if (/design|ux|user experience|graphic|product/.test(text))
    return 'design or human-computer interaction';
  if (/biology|health|medicine|pharma|clinical|biomedical/.test(text))
    return 'health, life sciences, or biomedical study';
  return 'the subject area reflected in your education and experience';
}

export default function StudiesPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>({});
  const [resume, setResume] = useState<Resume | undefined>();
  const [loading, setLoading] = useState(true);
  const [destination, setDestination] = useState<string>('United States');
  const [studyType, setStudyType] = useState<StudyType>(
    'Master’s in Computer Science & Software Systems',
  );
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.replace('/');
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${API_URL}/users/profile`, { headers }).then((r) => (r.ok ? r.json() : {})),
      fetch(`${API_URL}/resumes`, { headers }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([userProfile, resumes]: [Profile, Resume[]]) => {
        setProfile(userProfile);
        const selected = resumes.find((item) => item._id === userProfile.primaryResumeId) ?? resumes[0];
        setResume(selected);

        // Pre-fill study type based on profile background
        const field = inferField(userProfile, selected);
        if (field.startsWith('business')) {
          setStudyType('Master of Business Administration (MBA)');
        } else if (field.startsWith('technology')) {
          setStudyType('Master’s in Computer Science & Software Systems');
        }
      })
      .catch(() =>
        setError(
          'Could not load your profile. You can still explore the study directories and university shortlists below.',
        ),
      )
      .finally(() => setLoading(false));
  }, [router]);

  const field = inferField(profile, resume);
  const pathIdeas = field.startsWith('technology')
    ? [
        'Computer science or software systems',
        'Data science or artificial intelligence',
        'Cybersecurity, cloud, or information systems',
      ]
    : field.startsWith('business')
      ? [
          'Business administration or management',
          'Business analytics or information systems',
          'Finance, marketing, or a specialist business degree',
        ]
      : field.startsWith('design')
        ? [
            'Human-computer interaction',
            'Interaction or product design',
            'Digital media or design research',
          ]
        : field.startsWith('health')
          ? [
              'Public health or health administration',
              'Biomedical or life-sciences research',
              'A specialist clinical or health-science program',
            ]
          : [
              'A deeper qualification in your current discipline',
              'An interdisciplinary program linked to your experience',
              'A professional degree aligned to your target role',
            ];

  const visibleExams = EXAMS.filter((exam) => {
    if (exam.name === 'IELTS' || exam.name === 'TOEFL iBT') return destination !== 'India';
    if (exam.name === 'GATE') return destination === 'India' || destination === 'Any destination';
    if (exam.name === 'CAT') return destination === 'India' || destination === 'Any destination';
    return true;
  });

  // Lookup the Top 5 Universities for destination & studyType
  const destinationData = UNIVERSITIES_DATA[destination] || UNIVERSITIES_DATA['Any destination'];
  const topUniversities: UniversityRequirement[] =
    destinationData[studyType] ||
    UNIVERSITIES_DATA['United States'][studyType] ||
    UNIVERSITIES_DATA['Any destination'][studyType] ||
    [];

  const countryPills = [
    'United States',
    'United Kingdom',
    'Germany',
    'Australia',
    'Canada',
    'India',
  ];

  return (
    <main className="career-page">
      <div className="career-container">
        <header className="career-topbar">
          <Link className="brand" href="/dashboard">
            <span className="brand-mark">c/</span>
            <span>career compass</span>
          </Link>
          <nav className="career-nav" aria-label="Dashboard navigation">
            <Link href="/dashboard">Overview</Link>
            <Link href="/dashboard/jobs">Jobs</Link>
            <Link href="/dashboard/learning">Skills &amp; courses</Link>
            <Link className="active" href="/dashboard/studies">
              Higher studies
            </Link>
            <Link href="/dashboard/profile">Profile</Link>
          </nav>
        </header>

        <section className="career-page-heading">
          <p className="career-eyebrow">HIGHER EDUCATION &amp; UNIVERSITY PLANNER</p>
          <h1>Top universities and admission criteria.</h1>
          <p>
            Select your target destination and type of higher study to explore the top 5
            accredited institutions, complete with GPA thresholds, test expectations, required
            documents, and direct links to their official portals.
          </p>
        </section>

        {error && (
          <p className="career-alert" role="status">
            {error}
          </p>
        )}

        {/* Controls Section */}
        <section className="career-study-controls">
          <div>
            <span className="career-kicker">PROFILE ALIGNMENT</span>
            <h2>{loading ? 'Reading your background…' : `Recommended track: ${field}`}</h2>
            <p>
              Recommendations are dynamically tailored to your profile background. You can switch
              the destination or degree track anytime below to compare entry requirements.
            </p>
            <div className="career-pills-row" aria-label="Quick destination selector">
              {countryPills.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`career-country-pill-btn ${destination === c ? 'active' : ''}`}
                  onClick={() => setDestination(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="career-filter-controls">
            <label htmlFor="study-destination">
              Target Destination
              <select
                id="study-destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                {DESTINATIONS_LIST.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="study-type">
              Type of Higher Study
              <select
                id="study-type"
                value={studyType}
                onChange={(e) => setStudyType(e.target.value as StudyType)}
              >
                {STUDY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {STUDY_TYPE_LABELS[type] || type}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* Top 5 Universities Section */}
        <section className="career-study-section">
          <div className="career-panel-heading">
            <div>
              <p className="career-eyebrow">TOP 5 ACCREDITED INSTITUTIONS</p>
              <h2>
                Top 5 Universities in {destination === 'Any destination' ? 'the World' : destination}{' '}
                for {studyType}
              </h2>
            </div>
            <span className="career-path-level">
              {topUniversities.length} of 5 Programs Listed
            </span>
          </div>

          <p className="career-section-intro">
            Curated top institutions based on academic prestige, faculty research power, and graduate
            outcomes. Review the prerequisites and visit the official university portal to apply.
          </p>

          {destination === 'Any destination' && (
            <div className="career-any-destination-prompt">
              <h3>Viewing Top Global Institutions</h3>
              <p>
                To see the specific top 5 institutions for a particular country, pick a destination
                above or click one of the quick selector pills:
              </p>
              <div className="career-pills-row" style={{ justifyContent: 'center' }}>
                {countryPills.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="career-country-pill-btn"
                    onClick={() => setDestination(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="career-uni-list">
            {topUniversities.map((uni) => (
              <article className="career-uni-card" key={`${uni.rank}-${uni.name}`}>
                <div className="career-uni-header">
                  <div className="career-uni-title-group">
                    <span className="career-uni-rank-badge">RANK #{uni.rank}</span>
                    <h3 className="career-uni-name">{uni.name}</h3>
                  </div>
                  <span className="career-uni-location-pill">📍 {uni.location}</span>
                </div>

                {uni.highlight && (
                  <div className="career-uni-highlight-box">
                    <strong>Program Distinction: </strong>
                    {uni.highlight}
                  </div>
                )}

                <div className="career-uni-requirements-grid">
                  <div className="career-uni-req-item">
                    <span className="career-uni-req-label">🎓 Academic / GPA Criteria</span>
                    <p className="career-uni-req-value">{uni.gpa}</p>
                  </div>

                  <div className="career-uni-req-item">
                    <span className="career-uni-req-label">📝 Standardized Tests</span>
                    <p className="career-uni-req-value">{uni.standardizedTests}</p>
                  </div>

                  <div className="career-uni-req-item">
                    <span className="career-uni-req-label">📋 Required Materials</span>
                    <div className="career-uni-doc-pills">
                      {uni.documents.map((doc, idx) => (
                        <span className="career-uni-doc-pill" key={idx}>
                          {doc}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="career-uni-req-item">
                    <span className="career-uni-req-label">⏳ Primary Deadlines</span>
                    <p className="career-uni-req-value">{uni.deadlines}</p>
                  </div>
                </div>

                <div className="career-uni-footer">
                  <span className="career-uni-acceptance">
                    {uni.acceptanceRate && (
                      <>
                        <strong>Selectivity:</strong> {uni.acceptanceRate}
                      </>
                    )}
                  </span>
                  <a
                    className="career-uni-action-btn"
                    href={uni.siteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Visit Official Admissions Portal ↗
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Exam Requirements Section */}
        <section className="career-study-section">
          <div className="career-panel-heading">
            <div>
              <p className="career-eyebrow">STANDARDIZED EXAMS</p>
              <h2>Key tests for {destination === 'Any destination' ? 'global' : destination} study</h2>
            </div>
          </div>
          <p className="career-section-intro">
            Required test scores vary by department and year. Verify whether your chosen institution
            waives GRE/GMAT or accepts alternate English proficiency tests.
          </p>
          <div className="career-exam-list">
            {visibleExams.map((exam) => (
              <article className="career-exam-row" key={exam.name}>
                <div className="career-exam-name">
                  <strong>{exam.name}</strong>
                  <span>{exam.label}</span>
                </div>
                <p>{exam.description}</p>
                <a href={exam.url} target="_blank" rel="noopener noreferrer">
                  Official information ↗
                </a>
              </article>
            ))}
          </div>
        </section>

        {/* Official Study Portals Directory */}
        <section className="career-study-section">
          <div className="career-panel-heading">
            <div>
              <p className="career-eyebrow">GOVERNMENT DIRECTORIES</p>
              <h2>Official national study portals</h2>
            </div>
          </div>
          <p className="career-section-intro">
            Use official national education agencies to verify student visa requirements, post-study
            work permits, accredited university lists, and government scholarships.
          </p>
          <div className="career-destination-grid">
            {DESTINATIONS.filter(
              (item) => destination === 'Any destination' || item.country === destination,
            ).map((item) => (
              <a
                className="career-destination-card"
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                key={item.country}
              >
                <span className="career-kicker">{item.country.toUpperCase()}</span>
                <h3>{item.label}</h3>
                <p>{item.detail}</p>
                <span className="career-inline-link">Open official guide ↗</span>
              </a>
            ))}
          </div>
        </section>

        <aside className="career-disclaimer">
          <strong>Important Admissions Advisory</strong>
          <p>
            Entry requirements, GPA formulas, test cutoffs, and deadlines can be updated by
            universities each admissions cycle. Always cross-check program prerequisites on the
            official institution admissions portals provided above prior to submitting applications.
          </p>
        </aside>

        <footer className="career-footer">
          <Link href="/dashboard">← Back to overview</Link>
          <Link href="/dashboard/profile">Update career profile →</Link>
        </footer>
      </div>
    </main>
  );
}
