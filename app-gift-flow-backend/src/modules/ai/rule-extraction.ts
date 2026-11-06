import { fold } from '../../common/text';
import { Candidate, ExtractionProvider } from './ai.types';
import { parseVnAmount } from './vn-amount';

/** Cụm quan hệ (đã fold) -> nhãn hiển thị. Dài trước ngắn. Không đoán khi người nói không nói. */
const REL_PHRASES: Array<[string, string]> = [
  ['ban than', 'Bạn thân'],
  ['ban be', 'Bạn bè'],
  ['ban bo', 'Bạn bố'],
  ['ban me', 'Bạn mẹ'],
  ['ben ngoai', 'Bên ngoại'],
  ['ben noi', 'Bên nội'],
  ['dong nghiep', 'Đồng nghiệp'],
  ['dong huong', 'Đồng hương'],
  ['ho hang', 'Họ hàng'],
  ['gia dinh', 'Gia đình'],
  ['hang xom', 'Hàng xóm'],
].sort((a, b) => b[0].length - a[0].length) as Array<[string, string]>;

const FILLER = new Set([
  'mung', 'tang', 'gui', 'dong', 'la', 'duoc', 'so', 'tien', 'voi', 'nhe', 'nha', 'da', 'xin',
  'phong', 'bi', 'moi', 'cho',
]);
const HONORIFICS = new Set([
  'anh', 'chi', 'em', 'ong', 'ba', 'co', 'chu', 'bac', 'di', 'cau', 'mo', 'thim', 'cu', 'thay', 'ban',
]);

const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .map((w) => (w ? w[0].toLocaleUpperCase('vi') + w.slice(1).toLocaleLowerCase('vi') : w))
    .join(' ');

/**
 * Trích xuất theo luật cho dev/demo (AI_PROVIDER=mock) và dùng làm baseline benchmark.
 * Heuristic: tên = phần trước số tiền; quan hệ = cụm khớp từ điển; bỏ từ đệm "mừng/tặng...".
 */
export class RuleExtractionProvider implements ExtractionProvider {
  readonly name = 'rule';

  async extract(transcript: string): Promise<Candidate> {
    const text = transcript.trim();
    const amt = parseVnAmount(text);
    const warnings: string[] = [];
    const tokens = text.split(/\s+/).filter(Boolean);
    const pre = tokens.slice(0, amt.startToken ?? tokens.length);

    // bỏ từ đệm ở cuối phần tên ("... mừng", "... tặng")
    while (pre.length && FILLER.has(fold(pre[pre.length - 1].replace(/[,;.]+$/g, '')))) pre.pop();

    let relationship: string | null = null;
    const segments = pre
      .join(' ')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const cleanedSegments: string[] = [];
    for (const seg of segments) {
      let s = seg;
      for (const [phrase, label] of REL_PHRASES) {
        const folded = fold(s);
        const at = folded.indexOf(phrase);
        const okBoundary = at >= 0 && (at === 0 || folded[at - 1] === ' ') &&
          (at + phrase.length === folded.length || folded[at + phrase.length] === ' ');
        if (okBoundary && relationship === null) {
          relationship = label;
          // cắt đúng đoạn trong chuỗi gốc (fold giữ nguyên độ dài ký tự)
          s = (s.slice(0, at) + s.slice(at + phrase.length)).replace(/\s+/g, ' ').trim();
          break;
        }
      }
      if (s) cleanedSegments.push(s);
    }

    let name = (cleanedSegments[0] ?? '').replace(/[,;.]+$/g, '').trim();
    // "Anh Nguyễn Văn Hùng" -> bỏ xưng hô khi đã có họ tên đầy đủ (>= 3 từ)
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 4 && HONORIFICS.has(fold(words[0]))) name = words.slice(1).join(' ');
    // bỏ từ đệm đầu câu
    name = name.replace(/^(?:xin\s+)?(?:chào\s+)?/i, '').trim();
    if (name) name = titleCase(name);

    if (!name) warnings.push('name_missing');
    if (amt.amount === null && !amt.ambiguous) warnings.push('amount_missing');
    if (amt.ambiguous) warnings.push('amount_ambiguous');
    if (amt.multiple) warnings.push('self_correction');

    return {
      guest_name: name || null,
      relationship_label: relationship,
      amount_vnd: amt.amount,
      currency: 'VND',
      needs_review: warnings.length > 0,
      warnings,
    };
  }
}
