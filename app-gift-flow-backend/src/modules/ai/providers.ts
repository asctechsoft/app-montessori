import { Logger } from '@nestjs/common';
import { AppConfig } from '../../config/config';
import { Candidate, ExtractionProvider, ProviderError, SttProvider, SttResult } from './ai.types';

/** fetch có timeout + retry giới hạn (chỉ với lỗi tạm thời: mạng/429/5xx). */
async function callWithRetry(
  cfg: AppConfig,
  label: string,
  doFetch: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const log = new Logger('AiProvider');
  let lastErr: unknown;
  for (let attempt = 0; attempt <= cfg.aiMaxRetries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.aiTimeoutMs);
    try {
      const res = await doFetch(ctl.signal);
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      // Không bao giờ log body (có thể chứa nội dung/PII) hay header Authorization.
      log.warn(`${label} HTTP ${res.status} (attempt ${attempt + 1})`);
      lastErr = new ProviderError(`${label} HTTP ${res.status}`, retryable);
      if (!retryable) break;
    } catch (e) {
      log.warn(`${label} network/timeout (attempt ${attempt + 1})`);
      lastErr = new ProviderError(`${label} ${(e as Error).name}`, true);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof ProviderError ? lastErr : new ProviderError(`${label} failed`);
}

/** STT thật qua API tương thích OpenAI. Tên model lấy từ cấu hình, không hardcode. */
export class OpenAiSttProvider implements SttProvider {
  readonly name = 'openai-stt';
  constructor(private readonly cfg: AppConfig) {}

  async transcribe(audio: Buffer, mime: string): Promise<SttResult> {
    const ext = mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : mime.includes('webm') ? 'webm' : 'm4a';
    const res = await callWithRetry(this.cfg, 'stt', (signal) => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `segment.${ext}`);
      form.append('model', this.cfg.sttModel);
      form.append('language', 'vi');
      form.append('response_format', 'json');
      // gợi ý ngữ cảnh giúp nhận đúng "triệu/nghìn/rưỡi" và tên riêng
      form.append('prompt', 'Ghi nhận tiền mừng cưới: tên khách, quan hệ, số tiền đồng. Ví dụ: Anh Hùng bạn bố mừng hai triệu rưỡi.');
      return fetch(`${this.cfg.openaiBaseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.openaiApiKey}` },
        body: form,
        signal,
      });
    });
    const json = (await res.json()) as { text?: string };
    return { transcript: (json.text ?? '').trim() };
  }
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['guest_name', 'relationship_label', 'amount_vnd', 'currency', 'needs_review', 'warnings'],
  properties: {
    guest_name: { type: ['string', 'null'] },
    relationship_label: { type: ['string', 'null'] },
    amount_vnd: { type: ['integer', 'null'] },
    currency: { type: 'string', enum: ['VND'] },
    needs_review: { type: 'boolean' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM_PROMPT = `Bạn trích xuất dữ liệu tiền mừng cưới từ MỘT lượt nói tiếng Việt (một phong bì).
Chỉ trả JSON đúng schema. Quy tắc:
- guest_name: tên khách như người nói; nếu có họ tên đầy đủ có thể bỏ xưng hô (Anh/Chị...). Không bịa; không có thì null.
- relationship_label: chỉ khi người nói nêu rõ (vd "bạn bố", "bên ngoại", "đồng nghiệp"); không suy đoán, thiếu thì null.
- amount_vnd: số nguyên VND. "hai triệu rưỡi"=2500000, "một triệu hai"=1200000, "500k"=500000.
- Nếu số tiền < 1000 mà không rõ đơn vị (vd "năm trăm"): amount_vnd=null, needs_review=true, warnings gồm "amount_ambiguous".
- Nếu người nói tự sửa ("hai triệu à nhầm ba triệu"): lấy số cuối, needs_review=true, warnings gồm "self_correction".
- Thiếu tên: warnings gồm "name_missing", needs_review=true. Thiếu tiền: "amount_missing", needs_review=true.
- Nếu không phải lời đọc tiền mừng (ồn, người khác nói): tất cả null, needs_review=true, warnings ["no_content"].
Không giải thích, không thêm trường.`;

export class OpenAiExtractionProvider implements ExtractionProvider {
  readonly name = 'openai-llm';
  constructor(private readonly cfg: AppConfig) {}

  async extract(transcript: string): Promise<Candidate> {
    const res = await callWithRetry(this.cfg, 'llm', (signal) =>
      fetch(`${this.cfg.openaiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.cfg.llmModel,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: transcript },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'gift_envelope', strict: true, schema: EXTRACTION_SCHEMA },
          },
        }),
        signal,
      }),
    );
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new ProviderError('llm empty response', true);
    try {
      return JSON.parse(content) as Candidate;
    } catch {
      throw new ProviderError('llm invalid json', true);
    }
  }
}

/** Câu mẫu cho STT mock: chạy được toàn bộ luồng khi chưa có API key. Chỉ dùng dev. */
const MOCK_SAMPLES = [
  'Anh Nguyễn Văn Hùng, bạn bố, hai triệu',
  'Cô Hoa bên ngoại năm trăm nghìn',
  'Anh Thành mừng một triệu rưỡi',
  'Bác Tư năm trăm',
  'Chị Lan đồng nghiệp một triệu',
  'Em Đức bạn thân hai triệu',
  'Anh Hùng hai triệu à nhầm ba triệu',
  'Anh Nguyễn Văn Hùng, bạn bố, hai triệu',
];

export class MockSttProvider implements SttProvider {
  readonly name = 'mock-stt';
  private i = 0;

  async transcribe(_audio: Buffer, _mime: string, hint?: string): Promise<SttResult> {
    if (hint && hint.trim()) return { transcript: hint.trim() };
    const t = MOCK_SAMPLES[this.i % MOCK_SAMPLES.length];
    this.i++;
    return { transcript: t };
  }
}
