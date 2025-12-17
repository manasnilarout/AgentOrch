/**
 * Input data for RFQ processing
 */
export interface RfqInput {
  emailId: string;
  emailBody: string;
  senderEmail: string;
  receivedAt: Date;
  attachments: AttachmentInfo[];
  metadata?: Record<string, unknown>;
}

/**
 * Attachment information with MinIO reference
 */
export interface AttachmentInfo {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  bucketName: string;
  objectKey: string;
}

/**
 * Accumulated state as RFQ progresses through agents
 */
export interface RfqState {
  // Intake Agent output
  parsedData?: {
    customerName?: string;
    projectName?: string;
    projectReference?: string;
    requestedProducts: ProductRequest[];
    timeline?: string;
    specialRequirements?: string[];
  };

  // Missing Info Agent output
  missingFields?: string[];
  clarificationRequests?: ClarificationRequest[];

  // Duplicate Agent output
  duplicateCheckResult?: {
    isDuplicate: boolean;
    similarRfqIds?: string[];
    similarityScore?: number;
  };

  // Prioritization Agent output
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  complexity?: 'SIMPLE' | 'MODERATE' | 'COMPLEX';
  estimatedHours?: number;

  // MTO Agent output
  mtoData?: MaterialTakeOff;

  // Auto-Quote Agent output
  quote?: QuoteResult;
}

export interface ProductRequest {
  name: string;
  quantity?: number;
  unit?: string;
  specifications?: Record<string, unknown>;
  drawings?: string[];
}

export interface ClarificationRequest {
  field: string;
  question: string;
  context?: string;
}

export interface MaterialTakeOff {
  lineItems: MtoLineItem[];
  totalEstimatedCost?: number;
  notes?: string[];
}

export interface MtoLineItem {
  productCode: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  totalPrice?: number;
}

export interface QuoteResult {
  quoteNumber: string;
  validUntil: Date;
  lineItems: QuoteLineItem[];
  subtotal: number;
  tax?: number;
  total: number;
  terms?: string;
  notes?: string[];
}

export interface QuoteLineItem {
  productCode: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}
