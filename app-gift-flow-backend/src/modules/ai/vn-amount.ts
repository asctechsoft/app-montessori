import { fold } from '../../common/text';

export interface AmountParse {
  /** VND nguyên; null nếu không có số tiền hoặc không đủ chắc chắn. */
  amount: number | null;
  /** Số < 1000 không rõ đơn vị (vd "năm trăm"): KHÔNG đoán nghìn/triệu. */
  ambiguous: boolean;
  /** Có nhiều số tiền trong câu (nói lại/sửa: "hai triệu à nhầm ba triệu"). */
  multiple: boolean;
  /** Chỉ số token (tách theo khoảng trắng) nơi cụm số tiền bắt đầu; null nếu không thấy. */
  startToken: number | null;
}

const DIGIT_WORDS: Record<string, number> = {
  khong: 0,
  mot: 1,
  hai: 2,
  ba: 3,
  bon: 4,
  tu: 4,
  nam: 5,
  lam: 5,
  sau: 6,
  bay: 7,
  tam: 8,
  chin: 9,
};
const UNIT_MULT: Record<string, number> = {
  nghin: 1_000,
  ngan: 1_000,
  k: 1_000,
  trieu: 1_000_000,
  tr: 1_000_000,
  ty: 1_000_000_000,
  ti: 1_000_000_000,
};
const NUM_RE = /^\d+(?:[.,]\d+)*$/;
const ATTACHED_RE = /^(\d[\d.,]*)(k|tr|trieu|nghin|ngan|ty|ti)$/;
const THOUSANDS_RE = /^\d{1,3}(?:[.,]\d{3})+$/;
const CURRENCY = new Set(['dong', 'd', 'vnd', 'vnđ', 'dongs']);

type Tok = { raw: string; f: string; idx: number };

function isNumberish(f: string): boolean {
  return (
    NUM_RE.test(f) ||
    f in DIGIT_WORDS ||
    f in UNIT_MULT ||
    f === 'muoi' ||
    f === 'tram' ||
    f === 'linh' ||
    f === 'le' ||
    f === 'ruoi'
  );
}

const hasUnitOrNumeric = (run: Tok[]) =>
  run.some((t) => NUM_RE.test(t.f) || t.f in UNIT_MULT || t.f === 'muoi' || t.f === 'tram');

/** Hai từ chỉ chữ số liền nhau (không có đơn vị xen giữa) => từ đầu là tên ("Bác Tư năm trăm"). */
function trimLeadingNameDigits(run: Tok[]): Tok[] {
  let start = 0;
  for (let i = 0; i < run.length - 1; i++) {
    if (run[i].f in DIGIT_WORDS && run[i + 1].f in DIGIT_WORDS) start = i + 1;
  }
  return run.slice(start);
}

function numericValue(f: string): { v: number; absolute: boolean } {
  if (THOUSANDS_RE.test(f)) return { v: Number(f.replace(/[.,]/g, '')), absolute: true };
  const v = Number(f.replace(',', '.'));
  return { v: Number.isFinite(v) ? v : 0, absolute: v >= 1000 };
}

function evalRun(run: Tok[]): { value: number; ambiguous: boolean } {
  let total = 0;
  let cur = 0;
  let digit: number | null = null;
  let lastUnit = 0;
  let ambiguous = false;
  let absolute = false;
  const flush = () => {
    if (digit !== null) {
      cur += digit;
      digit = null;
    }
  };
  for (const t of run) {
    const f = t.f;
    if (NUM_RE.test(f)) {
      const { v, absolute: abs } = numericValue(f);
      if (abs) {
        total += v;
        absolute = true;
      } else {
        digit = v;
      }
    } else if (f in DIGIT_WORDS) {
      digit = DIGIT_WORDS[f];
    } else if (f === 'muoi') {
      cur += (digit ?? 1) * 10;
      digit = null;
    } else if (f === 'tram') {
      cur += (digit ?? 1) * 100;
      digit = null;
    } else if (f === 'linh' || f === 'le') {
      /* "một trăm linh năm": bỏ qua từ đệm */
    } else if (f in UNIT_MULT) {
      flush();
      const group = cur === 0 ? 1 : cur;
      total += group * UNIT_MULT[f];
      lastUnit = UNIT_MULT[f];
      cur = 0;
    } else if (f === 'ruoi') {
      if (lastUnit > 0) total += lastUnit / 2;
      else ambiguous = true;
    }
  }
  flush();
  if (cur > 0) {
    if (lastUnit > 0) {
      // "một triệu hai" = 1,2tr ; "một triệu hai trăm" = 1,2tr ; "2 triệu 500" = 2,5tr
      if (cur < 10) total += (cur * lastUnit) / 10;
      else if (cur < 1000) {
        total += (cur * lastUnit) / 1000;
        if (cur < 100) ambiguous = true; // "một triệu hai mươi": 1,02tr hay 1,2tr?
      } else total += cur;
    } else if (absolute) {
      total += cur;
    } else {
      total = cur;
      ambiguous = true; // số trần < 1000, không rõ đơn vị
    }
  }
  return { value: Math.round(total), ambiguous };
}

/**
 * Phân tích số tiền tiếng Việt: "hai triệu rưỡi" -> 2.500.000, "500k" -> 500.000,
 * "năm trăm" -> ambiguous (không đoán). Tách khỏi LLM để cross-check server-side.
 */
export function parseVnAmount(text: string): AmountParse {
  const raw = text.trim().split(/\s+/).filter(Boolean);
  const toks: Tok[] = [];
  raw.forEach((r, idx) => {
    const cleaned = fold(r.replace(/^[,;.!?"'()…]+|[,;.!?"'()…]+$/g, ''));
    const m = ATTACHED_RE.exec(cleaned);
    if (m) {
      toks.push({ raw: r, f: m[1], idx });
      toks.push({ raw: r, f: m[2], idx });
    } else {
      toks.push({ raw: r, f: cleaned, idx });
    }
  });

  // Gom thành các cụm token liên tiếp là "từ chỉ số"; dấu phẩy/chấm câu ngắt cụm.
  const runs: Tok[][] = [];
  let cur: Tok[] = [];
  const closeRun = () => {
    if (cur.length) runs.push(cur);
    cur = [];
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const endsWithBreak = /[;!?]$/.test(raw[t.idx]) || /,$/.test(raw[t.idx]);
    if (CURRENCY.has(t.f)) {
      closeRun();
      continue;
    }
    if (isNumberish(t.f)) {
      cur.push(t);
      if (endsWithBreak && (toks[i + 1]?.idx !== t.idx)) closeRun();
    } else {
      closeRun();
    }
  }
  closeRun();

  const amountRuns = runs
    .map((r) => trimLeadingNameDigits(r))
    .filter((r) => r.length > 0 && hasUnitOrNumeric(r));
  if (amountRuns.length === 0) {
    return { amount: null, ambiguous: false, multiple: false, startToken: null };
  }
  const last = amountRuns[amountRuns.length - 1];
  const { value, ambiguous } = evalRun(last);
  return {
    amount: ambiguous || value <= 0 ? null : value,
    ambiguous,
    multiple: amountRuns.length > 1,
    startToken: last[0].idx,
  };
}
