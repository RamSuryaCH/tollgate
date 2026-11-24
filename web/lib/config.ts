// Browser-side API base URL. NEXT_PUBLIC_* values are inlined at build time, so this
// reference must stay literal (no destructuring or dynamic lookup).
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(
  /\/+$/,
  "",
);

export const STORAGE_KEYS = {
  apiKey: "tollgate.apiKey",
  adminKey: "tollgate.adminKey",
} as const;

export const DEFAULT_MODEL = "llama3.2:3b";
