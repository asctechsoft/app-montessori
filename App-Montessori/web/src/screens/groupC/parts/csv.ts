// CSV thuần phía trình duyệt: đọc (có ngoặc kép), ghi, tải về.

/** Đọc CSV (hỗ trợ ngoặc kép, dấu phẩy hoặc chấm phẩy, BOM). Trả về các hàng (bỏ hàng trống). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** Hàng đầu = tiêu đề; trả về mảng object theo tiêu đề (đã cắt khoảng trắng). */
export function csvToObjects(input: string): { headers: string[]; rows: Record<string, string>[] } {
  const all = parseCsv(input);
  if (all.length === 0) return { headers: [], rows: [] };
  const headers = all[0].map((h) => h.trim());
  return { headers, rows: all.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

const esc = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (headers: string[], rows: unknown[][]): string => '﻿' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Đọc một tệp văn bản người dùng chọn (giới hạn dung lượng). */
export function readFileText(file: File, maxBytes = 2_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error('Tệp quá lớn (tối đa 2 MB).'));
      return;
    }
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('Không đọc được tệp.'));
    r.readAsText(file, 'utf-8');
  });
}
