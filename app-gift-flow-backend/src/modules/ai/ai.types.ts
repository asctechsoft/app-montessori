/** Kết quả trích xuất cho MỘT phong bì / MỘT lượt nói (prompt contract). */
export interface Candidate {
  guest_name: string | null;
  relationship_label: string | null;
  amount_vnd: number | null;
  currency: 'VND';
  needs_review: boolean;
  warnings: string[];
}

export interface SttResult {
  transcript: string;
  /** token/giây audio dùng để theo dõi chi phí (nếu provider trả về) */
  usage?: number;
}

/** Interface để thay nhà cung cấp STT/LLM sau benchmark, không hardcode tên model. */
export interface SttProvider {
  readonly name: string;
  transcribe(audio: Buffer, mime: string, hint?: string): Promise<SttResult>;
}

export interface ExtractionProvider {
  readonly name: string;
  extract(transcript: string): Promise<Candidate>;
}

export const STT_PROVIDER = 'STT_PROVIDER';
export const EXTRACTION_PROVIDER = 'EXTRACTION_PROVIDER';

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}
