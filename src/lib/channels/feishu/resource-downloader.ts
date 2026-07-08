/**
 * Feishu message resource downloader (#291, #266).
 *
 * Downloads images/files/audio/video sent by users via the im.messageResource API,
 * with retry on transient failures. Produces FileAttachment objects ready for the
 * bridge attachments field.
 *
 * Requires im:resource tenant scope (auto-granted by PersonalAgent archetype).
 */

import type * as lark from '@larksuiteoapi/node-sdk';
import type { FileAttachment } from '@/types';
import crypto from 'crypto';

const LOG_TAG = '[feishu/resource]';

/** Max file download size (20 MB). Matches the PR #266 pattern. */
const MAX_FILE_SIZE = 20 * 1024 * 1024;
/** Max retries for resource downloads. */
const DOWNLOAD_MAX_RETRIES = 2;
/** Base delay between download retries (ms). */
const DOWNLOAD_RETRY_DELAY_MS = 1000;

/** Supported Feishu resource types */
export type FeishuResourceType = 'image' | 'file' | 'audio' | 'video';

/** MIME type mapping per resource type. Best-effort — Feishu doesn't always return MIME. */
const MIME_BY_TYPE: Record<FeishuResourceType, string> = {
  image: 'image/png',
  file: 'application/octet-stream',
  audio: 'audio/ogg',
  video: 'video/mp4',
};

/** Default file extension per resource type */
const EXT_BY_TYPE: Record<FeishuResourceType, string> = {
  image: 'png',
  file: 'bin',
  audio: 'ogg',
  video: 'mp4',
};

/** Shape of the SDK's messageResource.get response (not fully typed in SDK) */
interface MessageResourceResponse {
  getReadableStream(): AsyncIterable<Buffer | Uint8Array>;
  writeFile(path: string): Promise<void>;
}

/**
 * Access im.messageResource from lark.Client (typing workaround — SDK types are loose).
 */
function getMessageResourceApi(client: lark.Client): {
  get(payload: { path: { message_id: string; file_key: string }; params: { type: string } }): Promise<MessageResourceResponse>;
} {
  return (client as unknown as { im: { messageResource: { get: typeof getMessageResourceApi extends () => infer R ? R : never } } }).im.messageResource as {
    get(payload: { path: { message_id: string; file_key: string }; params: { type: string } }): Promise<MessageResourceResponse>;
  };
}

/**
 * Download a Feishu message resource with retry. Returns null on permanent failure
 * (size limit, missing key) or after all retries exhausted.
 */
export async function downloadResource(
  client: lark.Client,
  messageId: string,
  fileKey: string,
  resourceType: FeishuResourceType,
): Promise<FileAttachment | null> {
  if (!messageId || !fileKey) return null;

  for (let attempt = 0; attempt <= DOWNLOAD_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = DOWNLOAD_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
        console.log(LOG_TAG, `Download retry ${attempt}/${DOWNLOAD_MAX_RETRIES}: key=${fileKey}`);
      } else {
        console.log(LOG_TAG, `Downloading: type=${resourceType}, key=${fileKey}, msgId=${messageId}`);
      }

      const res = await getMessageResourceApi(client).get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type: resourceType === 'image' ? 'image' : 'file' },
      });

      if (!res) {
        console.warn(LOG_TAG, 'messageResource.get returned empty response');
        continue;
      }

      // Stream chunks with size cap
      const chunks: Buffer[] = [];
      let totalSize = 0;
      const readable = res.getReadableStream();
      for await (const chunk of readable) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalSize += buf.length;
        if (totalSize > MAX_FILE_SIZE) {
          console.warn(LOG_TAG, `Resource too large (>${MAX_FILE_SIZE}): key=${fileKey}`);
          return null; // Size limit — don't retry, caller gets null
        }
        chunks.push(buf);
      }

      if (totalSize === 0) {
        console.warn(LOG_TAG, `Empty resource: key=${fileKey}`);
        continue; // Empty is probably transient — retry
      }

      const buffer = Buffer.concat(chunks);
      const base64 = buffer.toString('base64');
      const mime = MIME_BY_TYPE[resourceType];
      const ext = EXT_BY_TYPE[resourceType];

      console.log(LOG_TAG, `Downloaded ${buffer.length} bytes: key=${fileKey}`);
      return {
        id: crypto.randomUUID(),
        name: `${fileKey}.${ext}`,
        type: mime,
        size: buffer.length,
        data: base64,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Permanent errors: stop retrying
      if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('permission')) {
        console.error(LOG_TAG, `Permanent download failure: ${msg}`);
        return null;
      }
      console.warn(LOG_TAG, `Download attempt ${attempt + 1} failed: ${msg}`);
    }
  }

  console.error(LOG_TAG, `Download exhausted after ${DOWNLOAD_MAX_RETRIES + 1} attempts: key=${fileKey}`);
  return null;
}
