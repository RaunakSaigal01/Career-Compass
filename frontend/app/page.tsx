'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import GoogleSignInButton from './components/GoogleSignInButton';

type Mode = 'login' | 'register';
const API_URL = 'http://localhost:3001';

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const isRegistering = mode === 'register';

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setNotice('');
  }

  function persistSession(accessToken: string, user: { id: string; email: string }) {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('user', JSON.stringify(user));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');

    if (isRegistering && !consent) {
      setNotice('Please accept the terms to continue.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(
        `${API_URL}/auth/${isRegistering ? 'register' : 'login'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            ...(isRegistering && { consentGiven: consent }),
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message ?? 'Unable to complete the request.');
      }

      if (data.accessToken && data.user) {
        persistSession(data.accessToken, data.user);
      }

      setPassword('');

      if (!isRegistering) {
        router.push('/dashboard');
      } else {
        setNotice(data.message ?? 'Account created. You can now sign in.');
        setMode('login');
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Unable to complete the request.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-label="Account access">
        <a className="brand" href="#top" aria-label="Career Compass home">
          <span className="brand-mark" aria-hidden="true">
            c/
          </span>
          <span>career compass</span>
        </a>

        <div className="auth-content">
          <header>
            <p className="eyebrow">A MORE THOUGHTFUL JOB SEARCH</p>
            <h1>
              {isRegistering
                ? 'Make a little room for what’s next.'
                : 'Good to see you again.'}
            </h1>
            <p className="intro">
              {isRegistering
                ? 'Keep your resume, ideas, and next steps in one calm place.'
                : 'Pick up where you left off.'}
            </p>
          </header>

          <div className="mode-switch" role="tablist" aria-label="Account type">
            <button
              className={!isRegistering ? 'active' : ''}
              onClick={() => switchMode('login')}
              role="tab"
              aria-selected={!isRegistering}
              type="button"
            >
              Sign in
            </button>
            <button
              className={isRegistering ? 'active' : ''}
              onClick={() => switchMode('register')}
              role="tab"
              aria-selected={isRegistering}
              type="button"
            >
              Create account
            </button>
          </div>

          <div className="social-login">
            <GoogleSignInButton
              consentGiven={consent}
              requireConsent={isRegistering}
              onAuthSuccess={(result) => {
                persistSession(result.accessToken, result.user);
                router.push('/dashboard');
              }}
              onError={setNotice}
            />
          </div>

          <div className="email-divider" aria-hidden="true">
            <span>or continue with email</span>
          </div>

          <form onSubmit={handleSubmit}>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            <div className="label-row">
              <label htmlFor="password">Password</label>
              {!isRegistering && (
                <button className="text-button" type="button">
                  Forgot password?
                </button>
              )}
            </div>

            <div className="password-field">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isRegistering ? 'new-password' : 'current-password'}
                placeholder={isRegistering ? 'At least 8 characters' : 'Enter your password'}
                minLength={isRegistering ? 8 : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                className="reveal"
                type="button"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>

            {isRegistering && (
              <label className="consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  I agree to the <a href="#terms">Terms of use</a> and{' '}
                  <a href="#privacy">Privacy policy</a>.
                </span>
              </label>
            )}

            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}

            <button className="primary-button" disabled={isSubmitting} type="submit">
              {isSubmitting
                ? isRegistering
                  ? 'Creating account...'
                  : 'Signing in...'
                : isRegistering
                  ? 'Create account'
                  : 'Sign in'}
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </div>

        <footer>
          © 2026 Career Compass <span>•</span> Made for the in-between.
        </footer>
      </section>
    </main>
  );
}