import { NextResponse } from 'next/server';

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true as const, data }, { status: 200, ...init });
}

export function jsonErr(
  code: string,
  message: string,
  status: number,
  details?: unknown
): NextResponse {
  return NextResponse.json(
    {
      ok: false as const,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
    },
    { status }
  );
}
