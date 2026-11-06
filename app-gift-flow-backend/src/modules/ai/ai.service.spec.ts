import { loadConfig } from '../../config/config';
import { AiService } from './ai.service';
import { MockSttProvider } from './providers';
import { RuleExtractionProvider } from './rule-extraction';

const cfg = loadConfig({
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  AI_PROVIDER: 'mock',
  DB_TYPE: 'sqljs',
} as NodeJS.ProcessEnv);

const ai = new AiService(new MockSttProvider(), new RuleExtractionProvider(), cfg);
const run = (hint: string) => ai.process(Buffer.alloc(16), 'audio/mp4', hint);

describe('AI pipeline (bộ câu bắt buộc trong blueprint)', () => {
  it('Anh Nguyễn Văn Hùng, bạn bố, hai triệu', async () => {
    const r = await run('Anh Nguyễn Văn Hùng, bạn bố, hai triệu.');
    expect(r.candidate).toMatchObject({
      guest_name: 'Nguyễn Văn Hùng',
      relationship_label: 'Bạn bố',
      amount_vnd: 2_000_000,
      needs_review: false,
    });
  });

  it('Cô Hoa bên ngoại năm trăm nghìn', async () => {
    const r = await run('Cô Hoa bên ngoại năm trăm nghìn');
    expect(r.candidate).toMatchObject({
      guest_name: 'Cô Hoa',
      relationship_label: 'Bên ngoại',
      amount_vnd: 500_000,
      needs_review: false,
    });
  });

  it('Anh Thành mừng một triệu rưỡi', async () => {
    const r = await run('Anh Thành mừng một triệu rưỡi');
    expect(r.candidate.amount_vnd).toBe(1_500_000);
    expect(r.candidate.guest_name).toBe('Anh Thành');
    expect(r.candidate.needs_review).toBe(false);
  });

  it('Bác Tư năm trăm -> pending_review, không đoán đơn vị', async () => {
    const r = await run('Bác Tư năm trăm');
    expect(r.candidate.amount_vnd).toBeNull();
    expect(r.candidate.needs_review).toBe(true);
    expect(r.candidate.warnings).toContain('amount_ambiguous');
  });

  it('nói sửa lại: không ghi hai khoản, buộc duyệt', async () => {
    const r = await run('Anh Hùng hai triệu à nhầm ba triệu');
    expect(r.candidate.amount_vnd).toBe(3_000_000);
    expect(r.candidate.needs_review).toBe(true);
    expect(r.candidate.warnings).toContain('self_correction');
  });

  it('thiếu tên -> pending_review (BR05/BR14)', async () => {
    const r = await run('hai triệu');
    expect(r.candidate.guest_name).toBeNull();
    expect(r.candidate.needs_review).toBe(true);
    expect(r.candidate.warnings).toContain('name_missing');
  });

  it('âm thanh yên lặng/ồn -> no_content, không bịa bản ghi', async () => {
    const r = await run(' ');
    // hint rỗng -> mock dùng câu mẫu; kiểm tra nhánh transcript quá ngắn trực tiếp:
    const empty = await new AiService(
      { name: 'x', transcribe: async () => ({ transcript: '...' }) },
      new RuleExtractionProvider(),
      cfg,
    ).process(Buffer.alloc(16), 'audio/mp4');
    expect(empty.candidate.warnings).toContain('no_content');
    expect(r.candidate).toBeDefined();
  });

  it('LLM trả số khác luật xác định -> dùng luật + buộc duyệt', () => {
    const c = ai.normalize(
      { guest_name: 'Hùng', amount_vnd: 200_000, needs_review: false, warnings: [] },
      'Anh Hùng hai triệu',
    );
    expect(c.amount_vnd).toBe(2_000_000);
    expect(c.warnings).toContain('amount_mismatch');
    expect(c.needs_review).toBe(true);
  });

  it('chặn số tiền vượt trần', () => {
    const c = ai.normalize({ guest_name: 'Hùng', amount_vnd: 5_000_000_000 }, 'Anh Hùng năm tỷ');
    expect(c.amount_vnd).toBeNull();
    expect(c.warnings).toContain('amount_out_of_range');
  });
});
