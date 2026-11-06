import * as fs from 'fs';

/** Nạp .env (nếu có) rồi đọc cấu hình một lần. Mọi secret chỉ đến từ môi trường. */
function loadDotEnv(): void {
  try {
    if (fs.existsSync('.env')) (process as any).loadEnvFile('.env');
  } catch {
    /* .env hỏng/không có: dùng env hệ thống */
  }
}
loadDotEnv();

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};
const bool = (v: string | undefined, d: boolean): boolean =>
  v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(v.toLowerCase());

export interface AppConfig {
  nodeEnv: string;
  isProd: boolean;
  port: number;
  dbType: 'postgres' | 'sqljs';
  databaseUrl: string;
  sqljsFile: string;
  jwtAccessSecret: string;
  jwtAccessTtl: number;
  refreshTtlDays: number;
  aiProvider: 'mock' | 'openai';
  openaiApiKey: string;
  openaiBaseUrl: string;
  sttModel: string;
  llmModel: string;
  aiTimeoutMs: number;
  aiMaxRetries: number;
  quotaLimit: number;
  maxAmountVnd: number;
  maxAudioBytes: number;
  maxAudioSeconds: number;
  duplicateWindowMinutes: number;
  storeTranscript: boolean;
  throttleLimit: number;
  throttleTtl: number;
  exportDir: string;
  exportTtlMinutes: number;
  corsOrigins: string[];
  docsEnabled: boolean;
  googleClientIds: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const cfg: AppConfig = {
    nodeEnv,
    isProd,
    port: num(env.PORT, 3000),
    dbType: env.DB_TYPE === 'postgres' ? 'postgres' : 'sqljs',
    databaseUrl: env.DATABASE_URL ?? '',
    sqljsFile: env.SQLJS_FILE ?? './data/giftflow.sqlite',
    jwtAccessSecret: env.JWT_ACCESS_SECRET ?? '',
    jwtAccessTtl: num(env.JWT_ACCESS_TTL_SECONDS, 900),
    refreshTtlDays: num(env.REFRESH_TTL_DAYS, 30),
    aiProvider: env.AI_PROVIDER === 'openai' ? 'openai' : 'mock',
    openaiApiKey: env.OPENAI_API_KEY ?? '',
    openaiBaseUrl: (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    sttModel: env.STT_MODEL ?? '',
    llmModel: env.LLM_MODEL ?? '',
    aiTimeoutMs: num(env.AI_TIMEOUT_MS, 25000),
    aiMaxRetries: num(env.AI_MAX_RETRIES, 1),
    quotaLimit: num(env.QUOTA_LIMIT_PER_PERIOD, 300),
    maxAmountVnd: num(env.MAX_AMOUNT_VND, 1_000_000_000),
    maxAudioBytes: num(env.MAX_AUDIO_BYTES, 3 * 1024 * 1024),
    maxAudioSeconds: num(env.MAX_AUDIO_SECONDS, 30),
    duplicateWindowMinutes: num(env.DUPLICATE_WINDOW_MINUTES, 10),
    storeTranscript: bool(env.STORE_TRANSCRIPT, true),
    throttleLimit: num(env.THROTTLE_LIMIT, 120),
    throttleTtl: num(env.THROTTLE_TTL_SECONDS, 60),
    exportDir: env.EXPORT_DIR ?? './exports',
    exportTtlMinutes: num(env.EXPORT_TTL_MINUTES, 30),
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    docsEnabled: bool(env.DOCS_ENABLED, !isProd),
    googleClientIds: (env.GOOGLE_CLIENT_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
  };
  validateConfig(cfg);
  return cfg;
}

/** Fail-fast: không chạy production với cấu hình thiếu/không an toàn. */
export function validateConfig(c: AppConfig): void {
  const problems: string[] = [];
  if (!c.jwtAccessSecret || c.jwtAccessSecret.length < 32) {
    problems.push('JWT_ACCESS_SECRET phải có ít nhất 32 ký tự');
  }
  if (c.isProd && c.jwtAccessSecret.includes('change-me')) {
    problems.push('JWT_ACCESS_SECRET vẫn là giá trị mẫu');
  }
  if (c.dbType === 'postgres' && !c.databaseUrl) problems.push('Thiếu DATABASE_URL');
  if (c.aiProvider === 'openai') {
    if (!c.openaiApiKey) problems.push('AI_PROVIDER=openai nhưng chưa có OPENAI_API_KEY');
    if (!c.sttModel || !c.llmModel) problems.push('Thiếu STT_MODEL / LLM_MODEL');
  }
  if (problems.length) {
    throw new Error('Cấu hình không hợp lệ:\n - ' + problems.join('\n - '));
  }
}

export const CONFIG = 'APP_CONFIG';
