export type MobileAttachmentKind =
  | 'RECEIPT'
  | 'INSTALL_PHOTO'
  | 'FIELD_DOCUMENT'
  | 'VENDOR_INVOICE';

export type QueueJobStatus =
  | 'queued'
  | 'uploading'
  | 'failed'
  | 'completed';

export interface UploadQueueJob {
  id: string;
  poId: string;
  poLabel?: string;
  kind: MobileAttachmentKind;
  localUri: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
  createdAt: number;
  retryCount: number;
  nextAttemptAt: number;
  status: QueueJobStatus;
  progress: number;
  lastError?: string;
  uploadId?: string;
  uploadUrl?: string;
  presignExpiresAtMs?: number;
  declaredSizeBytes?: number;
}

export interface EnqueueInput {
  poId: string;
  poLabel?: string;
  kind: MobileAttachmentKind;
  localUri: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
}
