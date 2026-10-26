import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // In a real app, we would forward the request to the backend API
  // For now, we'll proxy to the backend
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');

  try {
    const res = await fetch(`${backendUrl}/jobs/recommendations`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error('Failed to fetch job recommendations');
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch job recommendations' },
      { status: 500 }
    );
  }
}