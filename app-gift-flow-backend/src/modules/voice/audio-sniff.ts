/** Nhận diện định dạng audio bằng magic bytes (không tin Content-Type/đuôi file do client gửi). */
export function sniffAudioMime(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4'; // m4a / aac
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (b.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg'; // ogg / opus
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  if (b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}
