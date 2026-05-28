export interface VisitorContext {
  resolvedAt: string;
  source: "fresh" | "cache" | "fallback";
  anonymous: boolean;
  company?: CompanyContext;
  contact?: ContactContext;
  audiences: string[];
  intentSignals: string[];
  visit: VisitContext;
}

export interface CompanyContext {
  domain: string;
  name?: string;
  industry?: string;
  naics?: string;
  sic?: string;
  revenueRange?: string;
  employeeCount?: string;
  employeeBucket?: EmployeeBucket;
  technologies?: string[];
  linkedinUid?: string;
  hqCountry?: string;
  hqRegion?: string;
}

export interface ContactContext {
  email?: string;
  hem?: string;
  title?: string;
  seniority?: Seniority;
  department?: string;
  workHistory?: Array<{
    company: string;
    title: string;
    start?: string;
    end?: string;
  }>;
}

export interface VisitContext {
  isReturning: boolean;
  visitCount: number;
  lastSeenAt?: string;
  referrer?: string;
  country?: string;
  region?: string;
}

export type Seniority =
  | "IC"
  | "Manager"
  | "Director"
  | "VP"
  | "CXO"
  | "Founder";

export type EmployeeBucket =
  | "1-10"
  | "11-50"
  | "51-200"
  | "201-1000"
  | "1001-5000"
  | "5001+";

export interface AudienceRule {
  industries?: string[];
  naicsPrefixes?: string[];
  revenueRanges?: string[];
  employeeBuckets?: EmployeeBucket[];
  technologies?: string[];
  audiences?: string[];
  seniority?: Seniority[];
  departments?: string[];
  intent?: string[];
  countries?: string[];
  visitCountMin?: number;
  visitCountMax?: number;
  isReturning?: boolean;
  isKnownAccount?: boolean;
  fallback?: boolean;
}

export interface DelivrPluginOptions {
  pixelId: string;
  apiKey: string;
  dataApiUrl: string;
  pixelApiUrl?: string;
  integrationApiUrl?: string;
  enableBlockRules?: boolean;
  enableVariantFields?: boolean;
  enableAudienceSync?: boolean;
  enableWebhook?: boolean;
  enablePerformanceMirror?: boolean;
  resolutionTimeoutMs?: number;
  cacheTtlSeconds?: number;
  cookieName?: string;
  requireConsent?: () => boolean | Promise<boolean>;
  collections?: { include?: string[]; exclude?: string[] };
  blocks?: { include?: string[]; exclude?: string[] };
  industries?: Array<{ label: string; value: string }>;
  revenueRanges?: Array<{ label: string; value: string }>;
  employeeBuckets?: Array<{ label: string; value: EmployeeBucket }>;
  seniorityLevels?: Array<{ label: string; value: Seniority }>;
}

export interface DelivrCache {
  get(key: string): Promise<VisitorContext | undefined>;
  set(key: string, value: VisitorContext, ttlSec: number): Promise<void>;
}
