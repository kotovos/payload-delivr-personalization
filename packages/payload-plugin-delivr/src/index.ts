import type { Config, Plugin } from "payload";
import type { DelivrPluginOptions } from "./types.js";

export type { DelivrPluginOptions } from "./types.js";
export type {
  VisitorContext,
  CompanyContext,
  ContactContext,
  VisitContext,
  AudienceRule,
  Seniority,
  EmployeeBucket,
  DelivrCache,
} from "./types.js";

const defaults = {
  pixelApiUrl: "https://pixel.delivr.ai",
  integrationApiUrl: "https://integration.delivr.ai",
  enableBlockRules: true,
  enableVariantFields: true,
  enableAudienceSync: true,
  enableWebhook: true,
  enablePerformanceMirror: false,
  resolutionTimeoutMs: 100,
  cacheTtlSeconds: 300,
  cookieName: "_dlvr",
};

export const delivrPlugin = (opts: DelivrPluginOptions): Plugin => {
  if (!opts.pixelId) throw new Error("[delivrPlugin] pixelId required");
  if (!opts.apiKey) throw new Error("[delivrPlugin] apiKey required");
  if (!opts.dataApiUrl) throw new Error("[delivrPlugin] dataApiUrl required");

  const config = { ...defaults, ...opts };

  return (incoming: Config): Config => {
    // Phase 1+: inject collections, fields, endpoints, jobs
    // Stub returns config unchanged. Functionality lands per ROADMAP.md.
    return incoming;
  };
};
