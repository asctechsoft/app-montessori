const MAP: Array<[string, string]> = [
  ['àáạảãâầấậẩẫăằắặẳẵ', 'a'],
  ['èéẹẻẽêềếệểễ', 'e'],
  ['ìíịỉĩ', 'i'],
  ['òóọỏõôồốộổỗơờớợởỡ', 'o'],
  ['ùúụủũưừứựửữ', 'u'],
  ['ỳýỵỷỹ', 'y'],
  ['đ', 'd'],
];

/** Chữ thường + bỏ dấu tiếng Việt (tìm kiếm / so sánh tên không phân biệt dấu). */
export function fold(input: string): string {
  const s = input.normalize('NFC').toLowerCase().trim();
  let out = '';
  for (const ch of s) {
    const hit = MAP.find(([chars]) => chars.includes(ch));
    out += hit ? hit[1] : ch;
  }
  return out.replace(/\s+/g, ' ');
}

/** Chống formula injection khi xuất Excel. */
export function excelSafe(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}
