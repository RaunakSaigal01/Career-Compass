'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

interface ScoreCategory {
  category: string;
  earned: number;
  max: number;
}

interface ScoreDeduction {
  ruleId: string;
  category: string;
  pointsChange: number;
  reason: string;
  action: string;
}

interface ResumeAnalysis {
  _id: string;
  totalScore: number;
  categoryScores: ScoreCategory[];
  deductions: ScoreDeduction[];
  extractedSkills: string[];
  jobDescription?: string;
  createdAt: string;
}

const API_URL = 'http://localhost:3001';

/** Extract a job title and short summary from a raw job description. */
function parseJobDescription(jd: string): { title: string; summary: string } {
  const lines = jd.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Try to find a title: look for common patterns or first line
  let title = 'Target Role';
  const titlePatterns = [
    /(senior|junior|lead|staff|principal|mid[- ]?level)?\s*(software|frontend|backend|full[- ]?stack|devops|data|cloud|mobile|web|qa|ml|ai|ios|android)\s*(engineer|developer|architect|analyst|scientist|manager|intern)/i,
    /(product|project|engineering|technical|program)\s*(manager|lead|director|owner)/i,
    /(react\s*native|react|node\.js|python|java|golang|flutter|swift|ios|android)\s*(developer|engineer)/i,
  ];

  for (const rawLine of lines.slice(0, 8)) {
    const line = rawLine
      .replace(
        /^(job\s*title|title|role|position|designation|job\s*role|looking\s*for)\s*[:–—\-]\s*/i,
        '',
      )
      .trim();

    for (const pattern of titlePatterns) {
      const match = line.match(pattern);
      if (match) {
        title = match[0].trim();
        break;
      }
    }
    if (title !== 'Target Role') break;

    if (
      rawLine.match(/^(job\s*title|title|role|position)\s*[:–—\-]\s*/i) &&
      line.length > 0 &&
      line.length <= 60
    ) {
      title = line.replace(/[:–—-]\s*$/, '').trim();
      break;
    }
  }

  // If no pattern matched, use the first line if it's short enough to be a title
  if (title === 'Target Role' && lines.length > 0) {
    const firstLine = lines[0]
      .replace(
        /^(job\s*title|title|role|position|designation|job\s*role|looking\s*for)\s*[:–—\-]\s*/i,
        '',
      )
      .trim();
    if (firstLine.length <= 80 && !firstLine.includes('.')) {
      title = firstLine.replace(/[:–—-]\s*$/, '').trim();
    }
  }

  // Build a summary: first 2-3 sentences, max 200 chars
  const fullText = lines.join(' ');
  const sentences = fullText.split(/(?<=[.!?])\s+/).slice(0, 3).join(' ');
  const summary = sentences.length > 200 ? sentences.slice(0, 197) + '…' : sentences;

  return { title, summary };
}

export default function ResumeAnalysisPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');

    if (!token) {
      router.replace('/');
      return;
    }

    fetch(`${API_URL}/resumes/${id}/analysis`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (res.status === 401) {
          localStorage.clear();
          router.replace('/');
          return;
        }

        if (!res.ok) {
          throw new Error('Could not load resume analysis.');
        }

        const data = (await res.json()) as ResumeAnalysis | null;
        setAnalysis(data);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [id, router]);

  if (isLoading) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <p>Loading analysis…</p>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <h1>Analysis unavailable</h1>
          <p className="notice" role="alert">
            {error}
          </p>
          <Link className="primary-button" href={`/dashboard/resume/${id}`}>
            Back to resume
          </Link>
        </section>
      </main>
    );
  }

  if (!analysis) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <h1>No analysis yet</h1>
          <p className="intro">
            Review your parsed profile, then score your resume to see feedback.
          </p>
          <Link className="primary-button" href={`/dashboard/resume/${id}`}>
            Review resume
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <header>
          <Link className="brand" href="/dashboard">
            <span className="brand-mark" aria-hidden="true">
              c/
            </span>
            <span>career compass</span>
          </Link>

          <p className="eyebrow">RESUME ANALYSIS</p>
          <h1>Your resume score: {analysis.totalScore}/100</h1>
          <p className="intro">
            Generated {new Date(analysis.createdAt).toLocaleString()}.
          </p>
        </header>

       <section>
  <h2 className="section-heading">Category scores</h2>

  <ul className="category-score-list">
    {analysis.categoryScores.map((score) => {
      const isExpanded = expandedCategory === score.category;
      const deductions = analysis.deductions.filter(
        (deduction) => deduction.category === score.category,
      );

      return (
        <li key={score.category} className="category-score-card">
          <button
            className="category-score-trigger"
            type="button"
            onClick={() =>
              setExpandedCategory(isExpanded ? null : score.category)
            }
            aria-expanded={isExpanded}
            aria-controls={`category-${score.category}`}
          >
            <span className="category-score-title">{score.category}</span>

            <span className="category-score-summary">
              <strong>
                {score.earned}/{score.max}
              </strong>
              <span aria-hidden="true">{isExpanded ? '−' : '+'}</span>
            </span>
          </button>

          {isExpanded && (
            <div
              id={`category-${score.category}`}
              className="category-score-details"
            >
              <p className="intro">
                Your score for this category is{' '}
                <strong>
                  {score.earned} out of {score.max}
                </strong>
                .
              </p>

              {deductions.length === 0 && score.earned === score.max ? (
  <p className="category-success">
    Excellent—this category meets all current scoring checks.
  </p>
) : deductions.length === 0 ? (
  <p className="category-warning">
    This category has room to improve, but no detailed recommendation is
    available yet.
  </p>
) : (
                <ul className="category-feedback-list">
                  {deductions.map((deduction) => (
                    <li key={deduction.ruleId} className="category-feedback">
                      <p>
                        <strong>{deduction.reason}</strong>
                      </p>

                      <p>
                        <span className="feedback-label">How to improve:</span>{' '}
                        {deduction.action}
                      </p>

                      <span className="feedback-points">
                        {deduction.pointsChange} points
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <Link
                className="text-button"
                href={`/dashboard/resume/${id}`}
              >
                Edit this part of my profile
              </Link>
            </div>
          )}
        </li>
      );
    })}
  </ul>
</section>

        <section>
          <h2 className="section-heading">Suggested improvements</h2>

          {analysis.deductions.length === 0 ? (
            <p className="intro">
              Great work—no major improvement areas were found.
            </p>
          ) : (
                        <ul className="deduction-list">
              {analysis.deductions.map((deduction) => (
                <li key={deduction.ruleId} className="deduction-card">
                  <div className="deduction-header">
                    <span className="deduction-category">{deduction.category}</span>
                    <span className="deduction-points">
                      {deduction.pointsChange} POINTS
                    </span>
                  </div>

                  <p className="deduction-reason">{deduction.reason}</p>
                  <p className="deduction-action">
                    <strong>What to do:</strong> {deduction.action}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="section-heading">Detected skills</h2>

          {analysis.extractedSkills.length === 0 ? (
            <p className="intro">No skills were detected.</p>
          ) : (
            <p className="intro">{analysis.extractedSkills.join(', ')}</p>
          )}
        </section>

        {analysis.jobDescription && (() => {
          const { title, summary } = parseJobDescription(analysis.jobDescription);
          return (
            <section>
              <h2 className="section-heading">Tailored to target role</h2>
              <h3 className="job-title-heading">{title}</h3>
              <p className="intro">{summary}</p>
              <details className="jd-details">
                <summary className="text-button">Show full description</summary>
                <p className="jd-full-text">{analysis.jobDescription}</p>
              </details>
            </section>
          );
        })()}

        <footer className="dashboard-footer">
          <Link className="text-button" href={`/dashboard/resume/${id}`}>
            Back to edit profile
          </Link>
          <span>•</span>
          <Link className="text-button" href="/dashboard">
            Back to dashboard
          </Link>
        </footer>
      </section>
    </main>
  );
}