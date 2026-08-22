'use client';

import { useEffect, useState } from 'react';

export default function Home() {
  const [message, setMessage] = useState('Loading...');

  useEffect(() => {
    fetch('http://localhost:3001')
      .then((response) => response.text())
      .then(setMessage)
      .catch(() => setMessage('Backend connection failed'));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-3xl font-bold">{message}</h1>
    </main>
  );
}