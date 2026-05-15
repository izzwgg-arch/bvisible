import fs from 'fs';
import path from 'path';

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function readDeployCommit(): string | undefined {
  try {
    const p = path.join(process.cwd(), '.bvisible-deploy-commit');
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function GET() {
  const commit = readDeployCommit();
  return NextResponse.json({
    status: 'ok',
    service: 'bvisible-web',
    ...(commit ? { commit } : {}),
  });
}
