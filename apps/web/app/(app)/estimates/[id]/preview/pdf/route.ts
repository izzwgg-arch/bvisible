import { NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/auth/current-user';
import {
  estimatePdfFilename,
  loadEstimatePdfData,
  renderEstimatePdfBuffer,
} from '@/lib/estimate/estimate-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const me = await requireTenantId();
  const { id } = await params;
  const data = await loadEstimatePdfData(me.tenantId, id);

  if (!data) {
    return new NextResponse('Estimate not found', { status: 404 });
  }

  const pdf = await renderEstimatePdfBuffer(data);

  const body = new Uint8Array(pdf);

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${estimatePdfFilename(data.number)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
