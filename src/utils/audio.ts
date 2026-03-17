/**
 * Helper to convert Float32Array (Web Audio) to Int16Array (PCM for Gemini)
 */
export function float32ToInt16(buffer: Float32Array): Int16Array {
  const l = buffer.length;
  const buf = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    buf[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return buf;
}

/**
 * Helper to convert Int16Array (PCM from Gemini) to Float32Array (Web Audio)
 */
export function int16ToFloat32(buffer: Int16Array): Float32Array {
  const l = buffer.length;
  const buf = new Float32Array(l);
  for (let i = 0; i < l; i++) {
    buf[i] = buffer[i] / 32768;
  }
  return buf;
}

/**
 * Base64 encoding for Int16Array
 */
export function base64EncodeAudio(buffer: Int16Array): string {
  const bytes = new Uint8Array(buffer.buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Base64 decoding to Int16Array
 */
export function base64DecodeAudio(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}
