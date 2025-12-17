import { RfqState, ProductRequest, MaterialTakeOff, AttachmentInfo } from '../shared/types/rfq.types.js';

// ============================================
// Intake Agent
// ============================================

export interface IntakeSystemContext {
  companyName: string;
  supportedProducts: string[];
  currentDate: string;
}

export interface IntakeUserContext {
  senderEmail: string;
  receivedAt: Date;
  emailBody: string;
  attachments: AttachmentInfo[];
}

// ============================================
// Missing Info Agent
// ============================================

export interface MissingInfoSystemContext {
  companyName: string;
  requiredFields: string[];
  optionalFields: string[];
}

export interface MissingInfoUserContext {
  parsedData: RfqState['parsedData'];
  customerName?: string;
  projectName?: string;
}

// ============================================
// Duplicate Agent
// ============================================

export interface DuplicateSystemContext {
  companyName: string;
  similarityThreshold: number;
  lookbackDays: number;
}

export interface DuplicateUserContext {
  parsedData: RfqState['parsedData'];
  senderEmail: string;
  recentRfqs?: Array<{
    id: string;
    customerName: string;
    projectName: string;
    createdAt: string;
  }>;
}

// ============================================
// Prioritization Agent
// ============================================

export interface PrioritizationSystemContext {
  companyName: string;
  priorityRules: Array<{
    condition: string;
    priority: string;
  }>;
  complexityRules: Array<{
    condition: string;
    complexity: string;
  }>;
}

export interface PrioritizationUserContext {
  parsedData: RfqState['parsedData'];
  customerName?: string;
  timeline?: string;
  productCount: number;
  hasDrawings: boolean;
  hasSpecialRequirements: boolean;
}

// ============================================
// MTO Agent
// ============================================

export interface MtoSystemContext {
  companyName: string;
  productCatalog: Array<{
    code: string;
    name: string;
    category: string;
  }>;
  unitConversions: Record<string, number>;
}

export interface MtoUserContext {
  parsedData: RfqState['parsedData'];
  requestedProducts: ProductRequest[];
  priority: string;
  complexity: string;
}

// ============================================
// Auto-Quote Agent
// ============================================

export interface AutoQuoteSystemContext {
  companyName: string;
  quotePolicies: string[];
  discountRules: Array<{
    condition: string;
    discount: number;
  }>;
  taxRate: number;
}

export interface AutoQuoteUserContext {
  parsedData: RfqState['parsedData'];
  mtoData: MaterialTakeOff;
  customerName?: string;
  priority: string;
  complexity: string;
}
