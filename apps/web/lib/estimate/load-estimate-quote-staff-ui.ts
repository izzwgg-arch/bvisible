import type { EstimateStatus, PrismaClient } from '@bvisible/db';

import { mergeEstimateStaffTimeline } from '@/lib/estimate/estimate-quote-timeline';
import {
  buildQuoteStaffSummary,
  pickActiveQuoteLink,
  type QuoteLinkRowSummaryInput,
  quotePhaseStaffBadgeLabel,
  shouldDisableQuoteLinkRegenerate,
} from '@/lib/estimate/quote-link-staff-summary';

export type EstimateQuoteLinkRowSerialized = {
  id: string;
  expiresAtIso: string | null;
  revokedAtIso: string | null;
  respondedAtIso: string | null;
  acceptedAtIso: string | null;
  declinedAtIso: string | null;
  lastViewedAtIso: string | null;
  createdAtIso: string;
};

export type EstimateTimelineRowSerialized = {
  rowKey: string;
  source: 'timeline_event' | 'audit_log';
  sortAtIso: string;
  title: string;
  subtitle: string | null;
};

export type EstimateQuoteStaffUiBundle = {
  quoteLinkRows: EstimateQuoteLinkRowSerialized[];
  quoteSummaryProps: {
    headline: string;
    detail: string | null;
    phaseLabel: string;
    estimateNumber: string;
    responderName: string | null;
    responderNote: string | null;
    respondedAtLabel: string | null;
    lastViewedAtLabel: string | null;
    linkIssuedAtLabel: string | null;
    linkExpiresAtLabel: string | null;
    activeLinkPresent: boolean;
  };
  timelineRows: EstimateTimelineRowSerialized[];
  quotePanelProps: {
    activeLink: EstimateQuoteLinkRowSerialized | null;
    phaseBadgeLabel: string;
    disableRegenerate: boolean;
    regenerateDisabledReason: string | null;
  };
};

const AUDIT_TIMELINE_ACTIONS = [
  'estimate_sent_to_client',
  'estimate_email_opened',
  'estimate_quote_viewed_public',
  'estimate_status_changed',
  'estimate_finalized',
  'estimate_unfinalized',
] as const;

function serializeQuoteLinkRow(row: QuoteLinkRowSummaryInput): EstimateQuoteLinkRowSerialized {
  return {
    id: row.id,
    expiresAtIso: row.expiresAt?.toISOString() ?? null,
    revokedAtIso: row.revokedAt?.toISOString() ?? null,
    respondedAtIso: row.respondedAt?.toISOString() ?? null,
    acceptedAtIso: row.acceptedAt?.toISOString() ?? null,
    declinedAtIso: row.declinedAt?.toISOString() ?? null,
    lastViewedAtIso: row.lastViewedAt?.toISOString() ?? null,
    createdAtIso: row.createdAt.toISOString(),
  };
}

export async function loadEstimateQuoteStaffUi(
  db: PrismaClient,
  tenantId: string,
  estimateId: string,
  estimateNumber: string,
  estimateStatus: EstimateStatus
): Promise<EstimateQuoteStaffUiBundle> {
  const now = new Date();

  const [linkRows, timelineEvents, timelineAudits] = await Promise.all([
    db.estimateQuoteLink.findMany({
      where: { tenantId, estimateId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        respondedAt: true,
        acceptedAt: true,
        declinedAt: true,
        acceptedByName: true,
        acceptedNote: true,
        declinedByName: true,
        declinedNote: true,
        lastViewedAt: true,
        createdAt: true,
      },
    }),
    db.estimateTimelineEvent.findMany({
      where: { tenantId, estimateId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, createdAt: true, metadata: true },
    }),
    db.auditLog.findMany({
      where: {
        tenantId,
        targetType: 'estimate',
        targetId: estimateId,
        action: { in: [...AUDIT_TIMELINE_ACTIONS] },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, action: true, createdAt: true, metadata: true },
    }),
  ]);

  const summaryInputs: QuoteLinkRowSummaryInput[] = linkRows.map((r) => ({
    id: r.id,
    revokedAt: r.revokedAt,
    expiresAt: r.expiresAt,
    respondedAt: r.respondedAt,
    acceptedAt: r.acceptedAt,
    declinedAt: r.declinedAt,
    acceptedByName: r.acceptedByName,
    acceptedNote: r.acceptedNote,
    declinedByName: r.declinedByName,
    declinedNote: r.declinedNote,
    lastViewedAt: r.lastViewedAt,
    createdAt: r.createdAt,
  }));

  const staffSummary = buildQuoteStaffSummary(now, estimateStatus, summaryInputs);

  const merged = mergeEstimateStaffTimeline(
    timelineEvents.map((e) => ({
      id: e.id,
      kind: e.kind,
      createdAt: e.createdAt,
      metadata: e.metadata,
    })),
    timelineAudits.map((a) => ({
      id: a.id,
      action: a.action,
      createdAt: a.createdAt,
      metadata: a.metadata as unknown,
    }))
  );

  const timelineRows: EstimateTimelineRowSerialized[] = merged.map((r) => ({
    rowKey: r.rowKey,
    source: r.source,
    sortAtIso: r.sortAt.toISOString(),
    title: r.title,
    subtitle: r.subtitle,
  }));

  const latest = staffSummary.latestLink;
  const disableRegenerate = shouldDisableQuoteLinkRegenerate(latest);

  const activeLinkModel = pickActiveQuoteLink(now, summaryInputs);
  const activeSerialized = activeLinkModel ? serializeQuoteLinkRow(activeLinkModel) : null;

  return {
    quoteLinkRows: summaryInputs.map(serializeQuoteLinkRow),
    quoteSummaryProps: {
      headline: staffSummary.headline,
      detail: staffSummary.detail,
      phaseLabel: quotePhaseStaffBadgeLabel(staffSummary.phase),
      estimateNumber,
      responderName: staffSummary.responderName,
      responderNote: staffSummary.responderNote,
      respondedAtLabel: staffSummary.respondedAt?.toISOString() ?? null,
      lastViewedAtLabel: latest?.lastViewedAt?.toISOString() ?? null,
      linkIssuedAtLabel: latest?.createdAt.toISOString() ?? null,
      linkExpiresAtLabel: latest?.expiresAt?.toISOString() ?? null,
      activeLinkPresent: staffSummary.activeLink !== null,
    },
    timelineRows,
    quotePanelProps: {
      activeLink: activeSerialized,
      phaseBadgeLabel: quotePhaseStaffBadgeLabel(staffSummary.phase),
      disableRegenerate,
      regenerateDisabledReason: disableRegenerate
        ? 'The newest link already has a customer decision recorded. Regenerating issues a new URL — only use if you intentionally want a fresh customer-facing quote.'
        : null,
    },
  };
}