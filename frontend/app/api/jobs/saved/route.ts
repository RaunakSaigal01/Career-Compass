import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');

  try {
    const res = await fetch(`${backendUrl}/jobs/saved`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error('Failed to fetch saved jobs');
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch saved jobs' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');

  try {
    const body = await request.json();
    const res = await fetch(`${backendUrl}/jobs/saved`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error('Failed to bookmark job');
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to bookmark job' },
      { status: 500 }
    );
  }
}