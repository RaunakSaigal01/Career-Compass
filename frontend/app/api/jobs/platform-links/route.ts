import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');

  try {
    const res = await fetch(`${backendUrl}/jobs/platform-links`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error('Failed to fetch platform links');
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch platform links' },
      { status: 500 }
    );
  }
}