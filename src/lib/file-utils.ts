import { nanoid } from 'nanoid';
import type { FileAttachment } from '@/types';

/**
 * Convert a data URL to a FileAttachment object.
 */
export async function dataUrlToFileAttachment(
  dataUrl: string,
  filename: string,
  mediaType: string,
): Promise<FileAttachment> {
  const payload = dataUrl.startsWith('data:')
    ? decodeDataUrl(dataUrl)
    : await readObjectUrl(dataUrl);

  return {
    id: nanoid(),
    name: filename,
    type: mediaType || payload.mediaType || 'application/octet-stream',
    size: payload.size,
    data: payload.base64,
  };
}

function decodeDataUrl(dataUrl: string): { base64: string; size: number; mediaType: string } {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) throw new Error('无效的 data URL');
  const metadata = dataUrl.slice(5, commaIndex);
  const encoded = dataUrl.slice(commaIndex + 1);
  const mediaType = metadata.split(';')[0] || 'application/octet-stream';
  if (metadata.toLowerCase().split(';').includes('base64')) {
    return { base64: encoded, size: base64DecodedSize(encoded), mediaType };
  }
  const bytes = new TextEncoder().encode(decodeURIComponent(encoded));
  return { base64: arrayBufferToBase64(bytes.buffer), size: bytes.byteLength, mediaType };
}

async function readObjectUrl(url: string): Promise<{ base64: string; size: number; mediaType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取附件失败: HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  return {
    base64: arrayBufferToBase64(buffer),
    size: buffer.byteLength,
    mediaType: response.headers.get('content-type') || 'application/octet-stream',
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64DecodedSize(data: string): number {
  if (!data) return 0;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(data.length * 3 / 4) - padding);
}
