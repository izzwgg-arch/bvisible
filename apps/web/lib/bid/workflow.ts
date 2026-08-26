// Bid workflow persistence: create a BID estimate, load everything the
// seven-step workspace renders, autosave project details / step position
// with optimistic concurrency, save design + installation decisions (which
// create/update real estimate lines), and controlled repricing from the
// current Sheet. All queries are tenant-scoped; nothing here checks roles —
// the server actions do.

import {
  BidInstallMode,
  EstimateStatus,
  EstimateType,
  Prisma,
  prisma,
  type BidLineReviewStatus,
  type PrismaClient,
} from '@bvisible/db';
import { nextEstimateNumber } from '@/lib/estimate/number';
import { recomputeEstimateTotals } from '@/lib/estimate/recompute-estimate-totals';
import { computeSalesTax } from '@/lib/estimate/sales-tax';
import { getTenantInvoiceProfile } from '@/lib/company/tenant-invoice-profile';
import { guardStaleBusinessInfo, type CompanyBusinessInfo } from '@/lib/company/business-info';
import { buildEstimateTerms } from '@/lib/estimate/estimate-terms';
import { getSheetSnapshot } from '@/lib/sheet-sync/sync';
import { loadBidPricingContext, type BidPricingContext } from './catalog';
import { buildBidChecklist, type BidChecklist } from './checklist';
import { DEFAULT_DESIGN_INPUTS, computeDesignLine, recommendDesignHours } from './design-calc';
import { DEFAULT_INSTALL_INPUTS, computeInstallLine, recommendInstallHours, type InstallScope } from './install-calc';
import { BID_SORT, BID_SOURCE_KIND, applyPricedLine, removeServiceLine, upsertServiceLine } from './lines';
import { matchStandardSign } from './match-standard-sign';
import { priceBidLine } from './price-line';
import { loadBidOperatingRates, multiplierMilliFromMarkupPercentMilli, type BidOperatingRates } from './rates';
import type { ImportSummary } from './import';
import { extractSignAttributes } from './text-extract';
import { BID_STEP_COUNT, type BidPricingSnapshot, type BidStep, type DesignInputs, type ExplanationStep, type InstallInputs, isBidStep } from './types';

type Db = Prisma.TransactionClient | PrismaClient;

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createBidEstimate(args: {
  tenantId: string;
  actorId: string;
  clientId: string;
  projectName: string;
  salesRepId: string | null;
}): Promise<{ id: string; number: string }> {
  const rates = await loadBidOperatingRates(args.tenantId);
  return prisma.$transaction(async (tx) => {
    const number = await nextEstimateNumber(tx, args.tenantId);
    const estimate = await tx.estimate.create({
      data: {
        tenantId: args.tenantId,
        clientId: args.clientId,
        number,
        title: args.projectName,
        estimateType: EstimateType.BID,
        // Bid lines carry final selling rates (markupExempt); the multiplier
        // is stored for completeness and the flat design fee is waived —
        // design is a real line from Step 5.
        multiplierMilli: multiplierMilliFromMarkupPercentMilli(rates.defaultMarkupPercentMilli),
        designFlatCents: 0,
        createdById: args.actorId,
        salesRepId: args.salesRepId,
      },
      select: { id: true, number: true },
    });
    await tx.bidEstimateWorkflow.create({
      data: {
        tenantId: args.tenantId,
        estimateId: estimate.id,
        currentStep: 1,
        completedSteps: [],
        projectName: args.projectName,
        lastSavedAt: new Date(),
        lastSavedById: args.actorId,
      },
    });
    return estimate;
  });
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export interface BidWorkspaceLine {
  id: string;
  sortOrder: number;
  kind: string;
  description: string;
  customerDescription: string | null;
  qtyMilli: number;
  unitCostCents: number;
  computedCostCents: number;
  qbItem: string | null;
  hiddenFromCustomer: boolean;
  taxable: boolean;
  isService: boolean;
  serviceKind: 'DESIGN' | 'INSTALL' | null;
  detail: {
    sourceFileId: string | null;
    sourceSheetName: string | null;
    sourceRowRef: string | null;
    sourceItem: string | null;
    sourceDescription: string | null;
    sourceQtyMilli: number;
    sourceUnit: string | null;
    sectionHeading: string | null;
    standardSignKey: string | null;
    standardSignName: string | null;
    matchLevel: string;
    matchConfidenceMilli: number;
    reviewStatus: BidLineReviewStatus;
    pricingUnit: string | null;
    pricingSource: string | null;
    explanation: ExplanationStep[];
    overrides: Record<string, unknown> | null;
    aiSuggestion: Record<string, unknown> | null;
  } | null;
  snapshot: Partial<BidPricingSnapshot> | null;
  openQuestionCount: number;
}

export interface BidWorkspaceQuestion {
  id: string;
  lineId: string | null;
  lineDescription: string | null;
  kind: string;
  status: string;
  title: string;
  sourceRef: string | null;
  sourceText: string | null;
  systemFound: string | null;
  whyUnsafe: string | null;
  whyMatters: string | null;
  choices: Array<Record<string, unknown>>;
  answerKey: string | null;
  answerValue: Record<string, unknown> | null;
  answerNote: string | null;
  answerScope: string | null;
  answeredByName: string | null;
  answeredAt: string | null;
  promotedStandardSignId: string | null;
  affectsPrice: boolean;
  createdAt: string;
}

export interface BidWorkspaceSource {
  id: string;
  role: string;
  status: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  supersedesId: string | null;
  supersededAt: string | null;
  isCurrentTakeoff: boolean;
  isEvidence: boolean;
  note: string | null;
  processingError: string | null;
  processedAt: string | null;
  result: Record<string, unknown> | null;
  uploadedByName: string | null;
  createdAt: string;
}

export interface BidWorkspaceData {
  estimate: {
    id: string;
    number: string;
    title: string;
    status: EstimateStatus;
    statusLabel: string;
    isFinalized: boolean;
    readOnly: boolean;
    clientId: string;
    client: { id: string; companyName: string; contactName: string | null; email: string | null; phone: string | null; address: string | null };
    salesRepId: string | null;
    salesRepName: string | null;
    subtotalCostCents: number;
    finalPriceCents: number;
    createdAt: string;
    updatedAt: string;
    linkedPoCount: number;
  };
  workflow: {
    currentStep: BidStep;
    completedSteps: number[];
    version: number;
    projectName: string | null;
    projectAddress: string | null;
    projectContactName: string | null;
    projectContactEmail: string | null;
    projectContactPhone: string | null;
    poNumber: string | null;
    customerReference: string | null;
    bidSource: string | null;
    dueDate: string | null;
    bidDeadline: string | null;
    internalNotes: string | null;
    importSummary: ImportSummary | null;
    designIncluded: boolean | null;
    designHoursMilli: number | null;
    designRateCents: number | null;
    designInputs: DesignInputs;
    designLineId: string | null;
    installIncluded: boolean | null;
    installMode: 'HOURS' | 'DAYS' | null;
    installQtyMilli: number | null;
    installRateCents: number | null;
    installInputs: InstallInputs;
    installLineId: string | null;
    lastSavedAt: string | null;
    /// Who wrote the current version — lets the client tell its OWN
    /// server-side saves (design, installation, office answers) apart from a
    /// genuine edit by someone else.
    lastSavedById: string | null;
  };
  sources: BidWorkspaceSource[];
  lines: BidWorkspaceLine[];
  questions: BidWorkspaceQuestion[];
  rates: BidOperatingRates;
  company: CompanyBusinessInfo;
  sheet: { status: 'OK' | 'ERROR'; syncedAt: string | null; lastError: string | null; standardSignCount: number; tabStatus: string };
  users: Array<{ id: string; name: string | null; email: string }>;
  clients: Array<{ id: string; companyName: string }>;
  permissions: { isAdmin: boolean; canAnswerRule: boolean; canApproveCustomRate: boolean; canPromote: boolean; canReprice: boolean; canUnfinalize: boolean };
  totals: {
    productionSubtotalCents: number;
    designCents: number;
    installCents: number;
    subtotalCents: number;
    taxPercentMilli: number;
    taxLabel: string;
    taxCents: number;
    totalCents: number;
  };
  installScope: InstallScope;
  designRecommendationHours: number;
  installRecommendation: { crewHours: number; crewDays: number; breakdown: ExplanationStep[] };
  checklist: BidChecklist;
  terms: string[];
  counts: { signLines: number; takeoffQty: number; autoPriced: number; needsReview: number; officeQuestions: number; blocked: number; openQuestions: number };
}

function parseDesignInputs(v: unknown): DesignInputs {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<DesignInputs>;
  return { ...DEFAULT_DESIGN_INPUTS, ...o, assumptions: Array.isArray(o.assumptions) ? o.assumptions.filter((a): a is string => typeof a === 'string') : [] };
}

function parseInstallInputs(v: unknown): InstallInputs {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<InstallInputs>;
  return { ...DEFAULT_INSTALL_INPUTS, ...o, customerAssumptions: Array.isArray(o.customerAssumptions) ? o.customerAssumptions.filter((a): a is string => typeof a === 'string') : [] };
}

/** Derive installation scope counts from the priced sign lines. */
export function deriveInstallScope(lines: ReadonlyArray<{ description: string; customerDescription: string | null; qtyMilli: number; hiddenFromCustomer: boolean; isService: boolean; snapshot: Partial<BidPricingSnapshot> | null; sectionHeading: string | null }>): InstallScope {
  const scope: InstallScope = { interiorSigns: 0, exteriorSigns: 0, letterCharacters: 0, illuminatedUnits: 0 };
  for (const l of lines) {
    if (l.isService || l.hiddenFromCustomer) continue;
    const text = `${l.description} ${l.customerDescription ?? ''} ${l.sectionHeading ?? ''}`;
    const attrs = extractSignAttributes(text);
    const qty = l.qtyMilli / 1000;
    if (l.snapshot?.pricingUnit === 'CHARACTER') {
      scope.letterCharacters += Math.round(qty);
      if (attrs.illuminated) scope.illuminatedUnits += Math.max(1, Math.round((l.snapshot.sourceQtyMilli ?? 1000) / 1000));
      continue;
    }
    const exterior = /exterior|parking|site|post|roadway|ev charging|monument|pylon|building id|address/i.test(text) || attrs.reflective;
    if (exterior) scope.exteriorSigns += Math.round(qty);
    else scope.interiorSigns += Math.round(qty);
    if (attrs.illuminated) scope.illuminatedUnits += Math.round(qty);
  }
  return scope;
}

export async function loadBidWorkspace(args: { tenantId: string; estimateId: string; actor: { id: string; role: 'USER' | 'ADMIN' | 'SUPER_ADMIN'; name?: string | null; email?: string } }): Promise<BidWorkspaceData | null> {
  const estimate = await prisma.estimate.findFirst({
    where: { id: args.estimateId, tenantId: args.tenantId, deletedAt: null, estimateType: EstimateType.BID },
    include: {
      client: { select: { id: true, companyName: true, contactName: true, email: true, phone: true, address: true } },
      salesRep: { select: { id: true, name: true, email: true } },
      bidWorkflow: true,
      tenant: { select: { id: true, name: true } },
      lines: {
        orderBy: [{ sortOrder: 'asc' }],
        include: { bidDetail: { include: { standardSign: { select: { name: true } } } } },
      },
      bidSourceFiles: { orderBy: [{ createdAt: 'asc' }], include: { uploadedBy: { select: { name: true, email: true } } } },
      bidQuestions: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { answeredBy: { select: { name: true, email: true } }, line: { select: { description: true } } } },
      _count: { select: { purchaseOrders: { where: { deletedAt: null } } } },
    },
  });
  if (!estimate || !estimate.bidWorkflow) return null;
  const wf = estimate.bidWorkflow;

  const [rates, companyProfile, snapshot, standardSignCount, users, clients] = await Promise.all([
    loadBidOperatingRates(args.tenantId),
    getTenantInvoiceProfile(prisma, estimate.tenant),
    getSheetSnapshot(args.tenantId),
    prisma.standardSign.count({ where: { tenantId: args.tenantId, active: true } }),
    // SUPER_ADMIN rows carry tenantId = null, so the signed-in operator and
    // the estimate's current rep are fetched explicitly — otherwise the rep
    // dropdown would render blank for them.
    prisma.user.findMany({
      where: { disabledAt: null, OR: [{ tenantId: args.tenantId }, { id: args.actor.id }] },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, email: true },
    }),
    prisma.client.findMany({ where: { tenantId: args.tenantId, deletedAt: null }, orderBy: [{ companyName: 'asc' }], take: 50, select: { id: true, companyName: true } }),
  ]);

  const openByLine = new Map<string, number>();
  for (const q of estimate.bidQuestions) if (q.status === 'OPEN' && q.lineId) openByLine.set(q.lineId, (openByLine.get(q.lineId) ?? 0) + 1);

  const lines: BidWorkspaceLine[] = estimate.lines.map((l) => {
    const isService = l.sourceKind === BID_SOURCE_KIND.DESIGN || l.sourceKind === BID_SOURCE_KIND.INSTALL;
    const d = l.bidDetail;
    return {
      id: l.id,
      sortOrder: l.sortOrder,
      kind: l.kind,
      description: l.description,
      customerDescription: l.customerDescription,
      qtyMilli: l.qtyMilli,
      unitCostCents: l.unitCostCents,
      computedCostCents: l.computedCostCents,
      qbItem: l.qbItem,
      hiddenFromCustomer: l.hiddenFromCustomer,
      taxable: l.taxable,
      isService,
      serviceKind: l.sourceKind === BID_SOURCE_KIND.DESIGN ? 'DESIGN' : l.sourceKind === BID_SOURCE_KIND.INSTALL ? 'INSTALL' : null,
      detail: d
        ? {
            sourceFileId: d.sourceFileId,
            sourceSheetName: d.sourceSheetName,
            sourceRowRef: d.sourceRowRef,
            sourceItem: d.sourceItem,
            sourceDescription: d.sourceDescription,
            sourceQtyMilli: d.sourceQtyMilli,
            sourceUnit: d.sourceUnit,
            sectionHeading: d.sectionHeading,
            standardSignKey: d.standardSignKey,
            standardSignName: d.standardSign?.name ?? null,
            matchLevel: d.matchLevel,
            matchConfidenceMilli: d.matchConfidenceMilli,
            reviewStatus: d.reviewStatus,
            pricingUnit: d.pricingUnit,
            pricingSource: d.pricingSource,
            explanation: Array.isArray(d.explanationJson) ? (d.explanationJson as unknown as ExplanationStep[]) : [],
            overrides: (d.overridesJson as Record<string, unknown> | null) ?? null,
            aiSuggestion: (d.aiSuggestionJson as Record<string, unknown> | null) ?? null,
          }
        : null,
      snapshot: (l.pricingInputsSnapshotJson as Partial<BidPricingSnapshot> | null) ?? null,
      openQuestionCount: openByLine.get(l.id) ?? 0,
    };
  });

  const questions: BidWorkspaceQuestion[] = estimate.bidQuestions.map((q) => ({
    id: q.id,
    lineId: q.lineId,
    lineDescription: q.line?.description ?? null,
    kind: q.kind,
    status: q.status,
    title: q.title,
    sourceRef: q.sourceRef,
    sourceText: q.sourceText,
    systemFound: q.systemFound,
    whyUnsafe: q.whyUnsafe,
    whyMatters: q.whyMatters,
    choices: Array.isArray(q.choicesJson) ? (q.choicesJson as Array<Record<string, unknown>>) : [],
    answerKey: q.answerKey,
    answerValue: (q.answerValueJson as Record<string, unknown> | null) ?? null,
    answerNote: q.answerNote,
    answerScope: q.answerScope,
    answeredByName: q.answeredBy?.name ?? q.answeredBy?.email ?? null,
    answeredAt: q.answeredAt?.toISOString() ?? null,
    promotedStandardSignId: q.promotedStandardSignId,
    affectsPrice: q.kind !== 'OTHER',
    createdAt: q.createdAt.toISOString(),
  }));

  const sources: BidWorkspaceSource[] = estimate.bidSourceFiles.map((f) => ({
    id: f.id,
    role: f.role,
    status: f.status,
    originalFilename: f.originalFilename,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    version: f.version,
    supersedesId: f.supersedesId,
    supersededAt: f.supersededAt?.toISOString() ?? null,
    isCurrentTakeoff: f.isCurrentTakeoff,
    isEvidence: f.isEvidence,
    note: f.note,
    processingError: f.processingError,
    processedAt: f.processedAt?.toISOString() ?? null,
    result: (f.resultJson as Record<string, unknown> | null) ?? null,
    uploadedByName: f.uploadedBy.name ?? f.uploadedBy.email,
    createdAt: f.createdAt.toISOString(),
  }));

  const visible = lines.filter((l) => !l.hiddenFromCustomer && l.detail?.reviewStatus !== 'EXCLUDED');
  const productionSubtotalCents = visible.filter((l) => !l.isService).reduce((s, l) => s + l.computedCostCents, 0);
  const designCents = visible.filter((l) => l.serviceKind === 'DESIGN').reduce((s, l) => s + l.computedCostCents, 0);
  const installCents = visible.filter((l) => l.serviceKind === 'INSTALL').reduce((s, l) => s + l.computedCostCents, 0);
  const subtotalCents = visible.reduce((s, l) => s + l.computedCostCents, 0);
  // Same two gates the customer PDF applies, so Step 7 totals match the
  // document that gets sent: each line's own taxable flag, and the exemption
  // that ignores the company rate for the whole estimate.
  const taxableSubtotalCents = visible.reduce((s, l) => s + (l.taxable ? l.computedCostCents : 0), 0);
  const tax = computeSalesTax(
    taxableSubtotalCents,
    estimate.taxExempt ? 0 : rates.salesTaxPercentMilli,
  );

  const designInputs = parseDesignInputs(wf.designInputsJson);
  const installInputs = parseInstallInputs(wf.installInputsJson);
  const installScope = deriveInstallScope(lines.map((l) => ({ description: l.description, customerDescription: l.customerDescription, qtyMilli: l.qtyMilli, hiddenFromCustomer: l.hiddenFromCustomer, isService: l.isService, snapshot: l.snapshot, sectionHeading: l.detail?.sectionHeading ?? null })));
  const uniqueLayouts = designInputs.uniqueLayouts > 0 ? designInputs.uniqueLayouts : visible.filter((l) => !l.isService).length;
  const designRec = recommendDesignHours({ ...designInputs, uniqueLayouts });
  const installRec = recommendInstallHours(installInputs, installScope, rates.installDayHours);
  const company = guardStaleBusinessInfo(companyProfile);
  const terms = buildEstimateTerms({ additional: installInputs.customerAssumptions });

  const isAdmin = args.actor.role === 'ADMIN' || args.actor.role === 'SUPER_ADMIN';
  const readOnly = estimate.status === EstimateStatus.FINALIZED;

  const signVisible = visible.filter((l) => !l.isService);
  const counts = {
    signLines: signVisible.length,
    takeoffQty: signVisible.reduce((s, l) => s + (l.detail?.sourceQtyMilli ?? 0), 0) / 1000,
    autoPriced: signVisible.filter((l) => l.detail?.reviewStatus === 'AUTO_PRICED' || l.detail?.reviewStatus === 'CONFIRMED').length,
    needsReview: signVisible.filter((l) => l.detail?.reviewStatus === 'NEEDS_REVIEW').length,
    officeQuestions: signVisible.filter((l) => l.detail?.reviewStatus === 'OFFICE_QUESTION').length,
    blocked: signVisible.filter((l) => l.detail?.reviewStatus === 'BLOCKED').length,
    openQuestions: questions.filter((q) => q.status === 'OPEN').length,
  };

  const checklist = buildBidChecklist({
    estimateStatus: estimate.status,
    customer: { companyName: estimate.client.companyName, email: estimate.client.email, address: estimate.client.address },
    project: { name: wf.projectName, address: wf.projectAddress },
    sourceFileCount: sources.length,
    takeoffProcessed: sources.some((s) => s.isCurrentTakeoff && s.status === 'READY'),
    lines: lines.map((l) => ({
      reviewStatus: l.detail?.reviewStatus ?? 'CONFIRMED',
      priced: l.detail?.pricingSource ? l.detail.pricingSource !== 'UNPRICED' : true,
      customerDescription: l.customerDescription,
      qbItem: l.qbItem,
      isService: l.isService,
      hidden: l.hiddenFromCustomer,
    })),
    questions: questions.map((q) => ({ status: q.status as 'OPEN' | 'ANSWERED' | 'DISMISSED', affectsPrice: q.affectsPrice })),
    designIncluded: wf.designIncluded,
    installIncluded: wf.installIncluded,
    qbmeReconciled: true, // bid lines are integer qty × cent rate; recomputed on Step 7 from the same data
    termsPresent: terms.length > 0,
    // Exempt is a deliberate choice, not a missing setting — it should not
    // raise the "sales tax not configured" warning on the checklist.
    taxConfigured: estimate.taxExempt || rates.salesTaxPercentMilli > 0,
    taxExempt: estimate.taxExempt,
  });

  return {
    estimate: {
      id: estimate.id,
      number: estimate.number,
      title: estimate.title,
      status: estimate.status,
      statusLabel: estimate.status.charAt(0) + estimate.status.slice(1).toLowerCase(),
      isFinalized: readOnly,
      readOnly,
      clientId: estimate.clientId,
      client: estimate.client,
      salesRepId: estimate.salesRepId,
      salesRepName: estimate.salesRep?.name ?? estimate.salesRep?.email ?? null,
      subtotalCostCents: estimate.subtotalCostCents,
      finalPriceCents: estimate.finalPriceCents,
      createdAt: estimate.createdAt.toISOString(),
      updatedAt: estimate.updatedAt.toISOString(),
      linkedPoCount: estimate._count.purchaseOrders,
    },
    workflow: {
      currentStep: isBidStep(wf.currentStep) ? wf.currentStep : 1,
      completedSteps: wf.completedSteps,
      version: wf.version,
      projectName: wf.projectName,
      projectAddress: wf.projectAddress,
      projectContactName: wf.projectContactName,
      projectContactEmail: wf.projectContactEmail,
      projectContactPhone: wf.projectContactPhone,
      poNumber: wf.poNumber,
      customerReference: wf.customerReference,
      bidSource: wf.bidSource,
      dueDate: wf.dueDate?.toISOString() ?? null,
      bidDeadline: wf.bidDeadline?.toISOString() ?? null,
      internalNotes: wf.internalNotes,
      importSummary: (wf.importSummaryJson as unknown as ImportSummary | null) ?? null,
      designIncluded: wf.designIncluded,
      designHoursMilli: wf.designHoursMilli,
      designRateCents: wf.designRateCents,
      designInputs: { ...designInputs, uniqueLayouts },
      designLineId: wf.designLineId,
      installIncluded: wf.installIncluded,
      installMode: wf.installMode,
      installQtyMilli: wf.installQtyMilli,
      installRateCents: wf.installRateCents,
      installInputs,
      installLineId: wf.installLineId,
      lastSavedAt: wf.lastSavedAt?.toISOString() ?? null,
      lastSavedById: wf.lastSavedById,
    },
    sources,
    lines,
    questions,
    rates,
    company,
    sheet: {
      status: snapshot.status,
      syncedAt: snapshot.syncedAt?.toISOString() ?? null,
      lastError: snapshot.lastError,
      standardSignCount,
      tabStatus: snapshot.data.standardSignsTabStatus ?? 'MISSING',
    },
    users: estimate.salesRep && !users.some((u) => u.id === estimate.salesRep!.id)
      ? [...users, { id: estimate.salesRep.id, name: estimate.salesRep.name, email: estimate.salesRep.email }]
      : users,
    clients,
    permissions: {
      isAdmin,
      canAnswerRule: true,
      canApproveCustomRate: isAdmin,
      canPromote: isAdmin,
      canReprice: isAdmin,
      canUnfinalize: isAdmin,
    },
    totals: {
      productionSubtotalCents,
      designCents,
      installCents,
      subtotalCents,
      taxPercentMilli: tax.percentMilli,
      taxLabel: tax.label,
      taxCents: tax.taxCents,
      // Full subtotal plus the tax charged, NOT tax.totalCents — that one only
      // adds up the taxable lines and would bill the customer short.
      totalCents: subtotalCents + tax.taxCents,
    },
    installScope,
    designRecommendationHours: designRec.recommendedHours,
    installRecommendation: installRec,
    checklist,
    terms,
    counts,
  };
}

// ---------------------------------------------------------------------------
// Autosave (project details + step position) with optimistic concurrency
// ---------------------------------------------------------------------------

export interface BidWorkflowPatch {
  currentStep?: BidStep;
  completedSteps?: number[];
  projectName?: string | null;
  projectAddress?: string | null;
  projectContactName?: string | null;
  projectContactEmail?: string | null;
  projectContactPhone?: string | null;
  poNumber?: string | null;
  customerReference?: string | null;
  bidSource?: string | null;
  dueDate?: string | null;
  bidDeadline?: string | null;
  internalNotes?: string | null;
  designInputs?: DesignInputs;
  installInputs?: InstallInputs;
}

export type SaveWorkflowResult =
  | { ok: true; version: number; savedAt: string }
  | { ok: false; conflict: true; version: number; error: string }
  | { ok: false; conflict: false; error: string };

export async function saveBidWorkflowPatch(args: {
  tenantId: string;
  estimateId: string;
  actorId: string;
  expectedVersion: number;
  patch: BidWorkflowPatch;
}): Promise<SaveWorkflowResult> {
  const wf = await prisma.bidEstimateWorkflow.findFirst({ where: { estimateId: args.estimateId, tenantId: args.tenantId }, select: { id: true, version: true, lastSavedById: true, estimate: { select: { status: true } } } });
  if (!wf) return { ok: false, conflict: false, error: 'Bid estimate not found.' };
  if (wf.estimate.status === EstimateStatus.FINALIZED) return { ok: false, conflict: false, error: 'Estimate is finalized. Unfinalize before editing.' };
  const p = args.patch;
  const now = new Date();
  const data: Prisma.BidEstimateWorkflowUncheckedUpdateManyInput = { version: { increment: 1 }, lastSavedAt: now, lastSavedById: args.actorId };
  if (p.currentStep !== undefined) data.currentStep = p.currentStep;
  if (p.completedSteps !== undefined) data.completedSteps = [...new Set(p.completedSteps.filter((s) => s >= 1 && s <= BID_STEP_COUNT))].sort((a, b) => a - b);
  for (const key of ['projectName', 'projectAddress', 'projectContactName', 'projectContactEmail', 'projectContactPhone', 'poNumber', 'customerReference', 'bidSource', 'internalNotes'] as const) {
    if (p[key] !== undefined) (data as Record<string, unknown>)[key] = p[key]?.trim() ? p[key]!.trim() : null;
  }
  if (p.dueDate !== undefined) data.dueDate = p.dueDate ? new Date(p.dueDate) : null;
  if (p.bidDeadline !== undefined) data.bidDeadline = p.bidDeadline ? new Date(p.bidDeadline) : null;
  if (p.designInputs !== undefined) data.designInputsJson = json(p.designInputs);
  if (p.installInputs !== undefined) data.installInputsJson = json(p.installInputs);

  let updated = await prisma.bidEstimateWorkflow.updateMany({ where: { id: wf.id, tenantId: args.tenantId, version: args.expectedVersion }, data });
  let effectiveVersion = args.expectedVersion;
  if (updated.count === 0) {
    // The row moved on. If THIS user's own server-side save moved it (saving
    // design, installation, or an office answer all bump the version), the
    // client's pending edits are not based on anyone else's change — fast
    // forward instead of raising a false conflict. A different user's save
    // still conflicts, so nothing of theirs is ever overwritten silently.
    const current = await prisma.bidEstimateWorkflow.findFirst({ where: { id: wf.id }, select: { version: true, lastSavedById: true } });
    if (!current || current.lastSavedById !== args.actorId) {
      return { ok: false, conflict: true, version: current?.version ?? wf.version, error: 'This estimate was changed elsewhere. Reload to continue.' };
    }
    effectiveVersion = current.version;
    updated = await prisma.bidEstimateWorkflow.updateMany({ where: { id: wf.id, tenantId: args.tenantId, version: current.version }, data });
    if (updated.count === 0) {
      const latest = await prisma.bidEstimateWorkflow.findFirst({ where: { id: wf.id }, select: { version: true } });
      return { ok: false, conflict: true, version: latest?.version ?? current.version, error: 'This estimate was changed elsewhere. Reload to continue.' };
    }
  }
  if (p.projectName !== undefined && p.projectName?.trim()) {
    await prisma.estimate.updateMany({ where: { id: args.estimateId, tenantId: args.tenantId }, data: { title: p.projectName.trim() } });
  }
  return { ok: true, version: effectiveVersion + 1, savedAt: now.toISOString() };
}

// ---------------------------------------------------------------------------
// Design / installation decisions → real lines
// ---------------------------------------------------------------------------

export async function saveDesignDecision(args: {
  tenantId: string;
  estimateId: string;
  actorId: string;
  included: boolean;
  inputs: DesignInputs;
}): Promise<{ ok: true; lineId: string | null; totalCents: number; hoursMilli: number; rateCents: number } | { ok: false; error: string }> {
  const wf = await prisma.bidEstimateWorkflow.findFirst({ where: { estimateId: args.estimateId, tenantId: args.tenantId }, include: { estimate: { select: { status: true } } } });
  if (!wf) return { ok: false, error: 'Bid estimate not found.' };
  if (wf.estimate.status === EstimateStatus.FINALIZED) return { ok: false, error: 'Estimate is finalized.' };
  const rates = await loadBidOperatingRates(args.tenantId);
  const calc = computeDesignLine(args.inputs, rates.designHourlyCents);
  const result = await prisma.$transaction(async (tx) => {
    let lineId: string | null = null;
    if (args.included) {
      const explanation: ExplanationStep[] = [
        ...calc.recommendation.breakdown,
        { label: 'Approved hours', value: `${calc.hoursMilli / 1000} h${args.inputs.approvedHours !== null && args.inputs.approvedHours !== calc.recommendation.recommendedHours ? ` (recommended ${calc.recommendation.recommendedHours} h)` : ''}` },
        { label: 'Rate', value: `$${(calc.rateCents / 100).toFixed(2)} per hour (company design rate)` },
        { label: 'Total', value: `${calc.hoursMilli / 1000} h × $${(calc.rateCents / 100).toFixed(2)} = $${(calc.totalCents / 100).toFixed(2)}` },
      ];
      lineId = await upsertServiceLine(tx, {
        tenantId: args.tenantId,
        estimateId: args.estimateId,
        existingLineId: wf.designLineId,
        kind: 'DESIGN',
        qtyMilli: calc.hoursMilli,
        rateCents: calc.rateCents,
        totalCents: calc.totalCents,
        description: 'Design',
        customerDescription: calc.description,
        snapshot: { engine: 'BID_RATE', formulaVersion: 'bid-pricing-v1', pricingMethod: 'PER_HOUR', pricingUnit: 'HOUR', pricingSource: 'OPERATING_RATE', rateSource: 'OPERATING_RATE', rateCents: calc.rateCents, billableQtyMilli: calc.hoursMilli, markupExempt: true, inputs: args.inputs, recommendedHours: calc.recommendation.recommendedHours, assumptions: calc.assumptions, computedTotalCents: calc.totalCents },
        explanation,
        pricingUnit: 'HOUR',
      });
    } else {
      await removeServiceLine(tx, args.tenantId, args.estimateId, wf.designLineId);
    }
    await tx.bidEstimateWorkflow.update({
      where: { id: wf.id },
      data: {
        designIncluded: args.included,
        designHoursMilli: args.included ? calc.hoursMilli : null,
        designRateCents: args.included ? calc.rateCents : null,
        designInputsJson: json(args.inputs),
        designLineId: lineId,
        completedSteps: [...new Set([...wf.completedSteps, 5])].sort((a, b) => a - b),
        version: { increment: 1 },
        lastSavedAt: new Date(),
        lastSavedById: args.actorId,
      },
    });
    await recomputeEstimateTotals(tx, args.tenantId, args.estimateId);
    return { lineId };
  });
  return { ok: true, lineId: result.lineId, totalCents: args.included ? calc.totalCents : 0, hoursMilli: calc.hoursMilli, rateCents: calc.rateCents };
}

export async function saveInstallDecision(args: {
  tenantId: string;
  estimateId: string;
  actorId: string;
  included: boolean;
  inputs: InstallInputs;
}): Promise<{ ok: true; lineId: string | null; totalCents: number; qtyMilli: number; rateCents: number } | { ok: false; error: string }> {
  const wf = await prisma.bidEstimateWorkflow.findFirst({ where: { estimateId: args.estimateId, tenantId: args.tenantId }, include: { estimate: { select: { status: true } } } });
  if (!wf) return { ok: false, error: 'Bid estimate not found.' };
  if (wf.estimate.status === EstimateStatus.FINALIZED) return { ok: false, error: 'Estimate is finalized.' };
  const rates = await loadBidOperatingRates(args.tenantId);
  const lines = await prisma.estimateLineItem.findMany({
    where: { estimateId: args.estimateId, tenantId: args.tenantId, sourceKind: { in: [BID_SOURCE_KIND.LINE, BID_SOURCE_KIND.MANUAL] } },
    select: { description: true, customerDescription: true, qtyMilli: true, hiddenFromCustomer: true, pricingInputsSnapshotJson: true, bidDetail: { select: { sectionHeading: true } } },
  });
  const scope = deriveInstallScope(lines.map((l) => ({ description: l.description, customerDescription: l.customerDescription, qtyMilli: l.qtyMilli, hiddenFromCustomer: l.hiddenFromCustomer, isService: false, snapshot: (l.pricingInputsSnapshotJson as Partial<BidPricingSnapshot> | null) ?? null, sectionHeading: l.bidDetail?.sectionHeading ?? null })));
  const rec = recommendInstallHours(args.inputs, scope, rates.installDayHours);
  const calc = computeInstallLine(args.inputs, rates, rec);
  const result = await prisma.$transaction(async (tx) => {
    let lineId: string | null = null;
    if (args.included) {
      const explanation: ExplanationStep[] = [
        ...rec.breakdown,
        { label: 'Entered', value: calc.formula },
        { label: 'Equivalent', value: `${calc.equivalentHours} crew-hours (${args.inputs.crewSize}-person crew)` },
        { label: 'Total', value: `$${(calc.totalCents / 100).toFixed(2)}` },
      ];
      lineId = await upsertServiceLine(tx, {
        tenantId: args.tenantId,
        estimateId: args.estimateId,
        existingLineId: wf.installLineId,
        kind: 'INSTALL',
        qtyMilli: calc.qtyMilli,
        rateCents: calc.rateCents,
        totalCents: calc.totalCents,
        description: 'Installation',
        customerDescription: calc.description,
        snapshot: { engine: 'BID_RATE', formulaVersion: 'bid-pricing-v1', pricingMethod: calc.mode === 'DAYS' ? 'PER_DAY' : 'PER_HOUR', pricingUnit: calc.mode === 'DAYS' ? 'DAY' : 'HOUR', pricingSource: 'OPERATING_RATE', rateSource: 'OPERATING_RATE', rateCents: calc.rateCents, billableQtyMilli: calc.qtyMilli, markupExempt: true, mode: calc.mode, equivalentHours: calc.equivalentHours, dayHours: rates.installDayHours, inputs: args.inputs, scope, recommendation: { crewHours: rec.crewHours, crewDays: rec.crewDays }, customerAssumptions: calc.customerAssumptions, computedTotalCents: calc.totalCents },
        explanation,
        pricingUnit: calc.mode === 'DAYS' ? 'DAY' : 'HOUR',
      });
    } else {
      await removeServiceLine(tx, args.tenantId, args.estimateId, wf.installLineId);
    }
    await tx.bidEstimateWorkflow.update({
      where: { id: wf.id },
      data: {
        installIncluded: args.included,
        installMode: args.included ? (calc.mode === 'DAYS' ? BidInstallMode.DAYS : BidInstallMode.HOURS) : null,
        installQtyMilli: args.included ? calc.qtyMilli : null,
        installRateCents: args.included ? calc.rateCents : null,
        installInputsJson: json({ ...args.inputs, customerAssumptions: calc.customerAssumptions }),
        installLineId: lineId,
        completedSteps: [...new Set([...wf.completedSteps, 6])].sort((a, b) => a - b),
        version: { increment: 1 },
        lastSavedAt: new Date(),
        lastSavedById: args.actorId,
      },
    });
    await recomputeEstimateTotals(tx, args.tenantId, args.estimateId);
    return { lineId };
  });
  return { ok: true, lineId: result.lineId, totalCents: args.included ? calc.totalCents : 0, qtyMilli: calc.qtyMilli, rateCents: calc.rateCents };
}

// ---------------------------------------------------------------------------
// Controlled repricing (drafts only, explicit, audited by the action)
// ---------------------------------------------------------------------------

export interface RepriceDiff {
  lineId: string;
  description: string;
  oldSource: string;
  newSource: string;
  oldRateCents: number;
  newRateCents: number;
  oldTotalCents: number;
  newTotalCents: number;
  differenceCents: number;
  reason: string;
  applicable: boolean;
}

export async function computeRepriceDiffs(args: { tenantId: string; estimateId: string; context?: BidPricingContext }): Promise<RepriceDiff[]> {
  const ctx = args.context ?? (await loadBidPricingContext(args.tenantId));
  const details = await prisma.bidLineDetail.findMany({
    where: { tenantId: args.tenantId, estimateId: args.estimateId, line: { sourceKind: BID_SOURCE_KIND.LINE }, reviewStatus: { not: 'EXCLUDED' } },
    include: { line: { select: { id: true, description: true, unitCostCents: true, computedCostCents: true, pricingInputsSnapshotJson: true } } },
  });
  const diffs: RepriceDiff[] = [];
  for (const d of details) {
    // Human decisions are never overwritten by a Sheet change.
    if (d.pricingSource === 'OFFICE_DECISION' || d.pricingSource === 'CUSTOM_RATE') continue;
    const snap = (d.line.pricingInputsSnapshotJson ?? {}) as Partial<BidPricingSnapshot>;
    const match = matchStandardSign({ name: d.sourceItem ?? d.line.description, description: d.sourceDescription }, ctx.catalog);
    if (!match.sign) continue;
    const priced = priceBidLine({
      candidate: { name: d.sourceItem ?? d.line.description, description: d.sourceDescription, qty: d.sourceQtyMilli / 1000, unit: d.sourceUnit, costCents: null, priceCents: null, priceConflict: false, sectionHeading: d.sectionHeading },
      match,
      sources: ctx.sources,
      sourceRef: d.sourceRowRef,
    });
    if (!priced.priced) continue;
    if (priced.rateCents === d.line.unitCostCents && priced.totalCents === d.line.computedCostCents) continue;
    diffs.push({
      lineId: d.line.id,
      description: d.line.description,
      oldSource: `${snap.rateSource ?? 'unknown'}${snap.sheetTab ? ` · ${snap.sheetTab}` : ''}${snap.sheetSyncedAt ? ` · synced ${snap.sheetSyncedAt.slice(0, 10)}` : ''}`,
      newSource: `${priced.snapshot.rateSource}${priced.snapshot.sheetTab ? ` · ${priced.snapshot.sheetTab}` : ''}${priced.snapshot.sheetSyncedAt ? ` · synced ${priced.snapshot.sheetSyncedAt.slice(0, 10)}` : ''}`,
      oldRateCents: d.line.unitCostCents,
      newRateCents: priced.rateCents,
      oldTotalCents: d.line.computedCostCents,
      newTotalCents: priced.totalCents,
      differenceCents: priced.totalCents - d.line.computedCostCents,
      reason: priced.rateCents !== d.line.unitCostCents ? 'Sheet / standard-sign rate changed since this line was priced.' : 'Billable quantity rule changed.',
      applicable: true,
    });
  }
  return diffs;
}

export async function applyRepriceDiffs(args: { tenantId: string; estimateId: string; actorId: string; lineIds: string[]; context?: BidPricingContext }): Promise<{ applied: RepriceDiff[] }> {
  const ctx = args.context ?? (await loadBidPricingContext(args.tenantId));
  const diffs = (await computeRepriceDiffs({ tenantId: args.tenantId, estimateId: args.estimateId, context: ctx })).filter((d) => args.lineIds.includes(d.lineId));
  await prisma.$transaction(async (tx) => {
    for (const diff of diffs) {
      const d = await tx.bidLineDetail.findFirstOrThrow({ where: { lineId: diff.lineId, tenantId: args.tenantId }, include: { line: { select: { description: true } } } });
      const match = matchStandardSign({ name: d.sourceItem ?? d.line.description, description: d.sourceDescription }, ctx.catalog);
      const priced = priceBidLine({
        candidate: { name: d.sourceItem ?? d.line.description, description: d.sourceDescription, qty: d.sourceQtyMilli / 1000, unit: d.sourceUnit, costCents: null, priceCents: null, priceConflict: false, sectionHeading: d.sectionHeading },
        match,
        sources: ctx.sources,
        sourceRef: d.sourceRowRef,
      });
      const status: BidLineReviewStatus = d.reviewStatus === 'CONFIRMED' ? 'CONFIRMED' : priced.reviewStatus;
      await applyPricedLine(tx, {
        tenantId: args.tenantId,
        estimateId: args.estimateId,
        lineId: diff.lineId,
        priced: { ...priced, questions: [] },
        match,
        reviewStatus: status,
        explanationExtra: [{ label: 'Repriced', value: `From $${(diff.oldRateCents / 100).toFixed(2)} to $${(diff.newRateCents / 100).toFixed(2)} using the current Sheet`, note: `by user ${args.actorId} on ${new Date().toISOString().slice(0, 10)}` }],
        keepDescription: true,
      });
    }
    await recomputeEstimateTotals(tx, args.tenantId, args.estimateId);
  });
  return { applied: diffs };
}

// ---------------------------------------------------------------------------
// Misc helpers used by actions
// ---------------------------------------------------------------------------

/** Confirm a yellow line (human reviewed the interpretation). */
export async function confirmBidLine(db: Db, args: { tenantId: string; estimateId: string; lineId: string }): Promise<boolean> {
  const r = await db.bidLineDetail.updateMany({ where: { tenantId: args.tenantId, estimateId: args.estimateId, lineId: args.lineId, reviewStatus: { in: ['NEEDS_REVIEW', 'AUTO_PRICED'] } }, data: { reviewStatus: 'CONFIRMED' } });
  return r.count > 0;
}

export { BID_SORT };
