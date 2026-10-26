import { NextRequest, NextResponse } from 'next/server';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; }> }
) {
  const { id } = await context.params;
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');

  try {
    const body = await request.json();
    const res = await fetch(`${backendUrl}/jobs/saved/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error('Failed to update job status');
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update job status' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; }> }
) {
  const { id } = await context.params;
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');

  try {
    const res = await fetch(`${backendUrl}/jobs/saved/${id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error('Failed to delete job');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete job' },
      { status: 500 }
    );
  }
}