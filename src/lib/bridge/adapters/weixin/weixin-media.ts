/**
 * WeChat media handling — AES-128-ECB encryption/decryption for CDN.
 *
 * WeChat CDN requires media to be encrypted before upload and
 * decrypted after download using AES-128-ECB with PKCS7 padding.
 */

import crypto from 'crypto';
import type { WeixinCredentials, MessageItem, CDNMedia } from './weixin-types';
import { MessageItemType, UploadMediaType } from './weixin-types';
import { getUploadUrl } from './weixin-api';

const MAX_MEDIA_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * Generate a random 16-byte AES key.
 */
export function generateMediaKey(): Buffer {
  return crypto.randomBytes(16);
}

/**
 * AES-128-ECB encrypt with PKCS7 padding.
 */
export function encryptMedia(data: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/**
 * AES-128-ECB decrypt with PKCS7 unpadding.
 */
export function decryptMedia(data: Buffer, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * Compute padded ciphertext size for AES-128-ECB.
 */
export function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

/**
 * Parse AES key from a message item. Handles both hex (aeskey field)
 * and base64 (media.aes_key field) formats.
 */
function parseAesKey(item: { aeskey?: string; media?: CDNMedia }): Buffer | null {
  // Prefer aeskey (hex format) if available
  if (item.aeskey && item.aeskey.length === 32) {
    return Buffer.from(item.aeskey, 'hex');
  }
  // Fallback to media.aes_key (base64 format)
  if (item.media?.aes_key) {
    return Buffer.from(item.media.aes_key, 'base64');
  }
  return null;
}

/**
 * Download and decrypt media from CDN.
 */
export async function downloadAndDecryptMedia(
  cdnUrl: string,
  aesKey: Buffer,
  label: string = 'media',
): Promise<Buffer> {
  const res = await fetch(cdnUrl, {
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`CDN download failed for ${label}: ${res.status}`);
  }

  const encrypted = Buffer.from(await res.arrayBuffer());

  if (encrypted.length > MAX_MEDIA_SIZE) {
    throw new Error(`Media too large: ${encrypted.length} bytes (max ${MAX_MEDIA_SIZE})`);
  }

  return decryptMedia(encrypted, aesKey);
}

/**
 * Extract downloadable media from a message item.
 * Returns null if no media is present or key is missing.
 */
export async function downloadMediaFromItem(
  item: MessageItem,
  cdnBaseUrl: string,
): Promise<{ data: Buffer; mimeType: string; filename: string } | null> {
  let encryptParam: string | undefined;
  let aesKey: Buffer | null = null;
  let mimeType = 'application/octet-stream';
  let filename = 'file';

  switch (item.type) {
    case MessageItemType.IMAGE:
      if (item.image_item) {
        encryptParam = item.image_item.media?.encrypt_query_param;
        aesKey = parseAesKey(item.image_item as { aeskey?: string; media?: CDNMedia });
        mimeType = 'image/jpeg';
        filename = `image_${Date.now()}.jpg`;
      }
      break;

    case MessageItemType.VOICE:
      if (item.voice_item) {
        encryptParam = item.voice_item.media?.encrypt_query_param;
        aesKey = parseAesKey(item.voice_item as { aeskey?: string; media?: CDNMedia });
        mimeType = 'audio/silk';
        filename = `voice_${Date.now()}.silk`;
      }
      break;

    case MessageItemType.FILE:
      if (item.file_item) {
        encryptParam = item.file_item.media?.encrypt_query_param;
        aesKey = parseAesKey(item.file_item as { aeskey?: string; media?: CDNMedia });
        filename = item.file_item.file_name || `file_${Date.now()}`;
        // Try to guess MIME from filename
        const ext = filename.split('.').pop()?.toLowerCase();
        if (ext) {
          const mimeMap: Record<string, string> = {
            pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            txt: 'text/plain', zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          };
          mimeType = mimeMap[ext] || mimeType;
        }
      }
      break;

    case MessageItemType.VIDEO:
      if (item.video_item) {
        encryptParam = item.video_item.media?.encrypt_query_param;
        aesKey = parseAesKey(item.video_item as { aeskey?: string; media?: CDNMedia });
        mimeType = 'video/mp4';
        filename = `video_${Date.now()}.mp4`;
      }
      break;
  }

  if (!encryptParam || !aesKey) return null;

  const cdnUrl = `${cdnBaseUrl}?${encryptParam}`;
  const data = await downloadAndDecryptMedia(cdnUrl, aesKey, filename);
  return { data, mimeType, filename };
}

/**
 * Encrypt and upload media to CDN.
 * Returns the download reference parameters for inclusion in sendMessage.
 */
export async function uploadMediaToCdn(
  creds: WeixinCredentials,
  data: Buffer,
  filename: string,
  mediaType: number,
): Promise<{ encryptQueryParam: string; aesKeyBase64: string; cipherSize: number }> {
  const plainMd5 = crypto.createHash('md5').update(data).digest('hex');
  const aesKey = generateMediaKey();
  const fileKey = crypto.randomBytes(16).toString('hex');
  const cipherSize = aesEcbPaddedSize(data.length);

  // Get pre-signed upload URL
  const urlResp = await getUploadUrl(creds, fileKey, mediaType, data.length, plainMd5, cipherSize);
  if (!urlResp.upload_param) {
    throw new Error('Failed to get upload URL from WeChat');
  }

  // Encrypt
  const encrypted = encryptMedia(data, aesKey);

  // Upload to CDN
  const cdnUrl = `${creds.cdnBaseUrl}?${urlResp.upload_param}`;
  const uploadRes = await fetch(cdnUrl, {
    method: 'PUT',
    body: new Uint8Array(encrypted),
    signal: AbortSignal.timeout(60_000),
  });

  if (!uploadRes.ok) {
    throw new Error(`CDN upload failed: ${uploadRes.status}`);
  }

  return {
    encryptQueryParam: urlResp.upload_param,
    aesKeyBase64: aesKey.toString('base64'),
    cipherSize: encrypted.length,
  };
}
