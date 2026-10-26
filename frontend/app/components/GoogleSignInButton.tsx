'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: {
              theme: 'outline';
              size: 'large';
              text: 'continue_with';
              width: number;
            },
          ) => void;
        };
      };
    };
  }
}

interface AuthResult {
  message: string;
  accessToken: string;
  user: {
    id: string;
    email: string;
  };
}

type GoogleSignInButtonProps = {
  consentGiven: boolean;
  requireConsent: boolean;
  onAuthSuccess: (result: AuthResult) => void;
  onError: (message: string) => void;
};

export default function GoogleSignInButton({
  consentGiven,
  requireConsent,
  onAuthSuccess,
  onError,
}: GoogleSignInButtonProps) {
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

    if (!clientId || !buttonRef.current) {
      return;
    }

    function renderGoogleButton() {
      if (!window.google || !buttonRef.current || !clientId) {
        return;
      }

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
  if (requireConsent && !consentGiven) {
    onError('Please accept the Terms of use and Privacy policy to continue.');
    return;
  }

  try {
    const response = await fetch('http://localhost:3001/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential,
        consentGiven,
      }),
    });

    const data: AuthResult = await response.json();

    if (!response.ok) {
      throw new Error(data.message ?? 'Google sign-in failed.');
    }

    onAuthSuccess(data);
  } catch (error) {
    onError(
      error instanceof Error ? error.message : 'Google sign-in failed.',
    );
  }
},
      });

      buttonRef.current.innerHTML = '';

      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        width: 410,
      });
    }

    const existingScript = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]',
    );

    if (existingScript) {
      renderGoogleButton();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = renderGoogleButton;

    document.head.appendChild(script);
  }, [consentGiven, requireConsent, onError, onAuthSuccess]);

  return <div ref={buttonRef} />;
}