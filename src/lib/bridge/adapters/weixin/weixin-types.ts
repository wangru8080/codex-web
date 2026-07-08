/**
 * WeChat protocol types — derived from OpenClaw weixin plugin reference.
 * Used as protocol specification only, not runtime dependency.
 */

export const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const;

export const MessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const;

export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

export interface CDNMedia {
  encrypt_query_param: string;
  aes_key: string; // base64 encoded
  encrypt_type: number;
}

export interface TextItem {
  text: string;
}

export interface ImageItem {
  media?: CDNMedia;
  aeskey?: string; // hex
  mid_size?: number;
}

export interface VoiceItem {
  media?: CDNMedia;
  voice_length_ms?: number;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  file_size?: number;
}

export interface VideoItem {
  media?: CDNMedia;
  video_length_s?: number;
}

export interface MessageItem {
  type: number;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: string;
  msg_type?: number;
  from_user_id: string;
  to_user_id?: string;
  item_list?: MessageItem[];
  context_token?: string;
  create_time?: number;
  state?: number;
  ref_message?: {
    title?: string;
    content?: string;
    item_list?: MessageItem[];
  };
}

export interface GetUpdatesRequest {
  get_updates_buf?: string;
  timeout_ms?: number;
}

export interface GetUpdatesResponse {
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

/** SendMessage request: wraps a single WeixinMessage + base_info. */
export interface SendMessageRequest {
  msg: {
    from_user_id: string;
    to_user_id: string;
    client_id: string;
    message_type: number;
    message_state: number;
    item_list?: MessageItem[];
    context_token?: string;
  };
  base_info?: { channel_version?: string };
}

/** SendMessage response is effectively empty on success. */
export interface SendMessageResponse {
  errcode?: number;
  errmsg?: string;
}

export interface GetUploadUrlRequest {
  file_key: string;
  file_type: number;
  file_size: number;
  file_md5: string;
  cipher_file_size: number;
}

export interface GetUploadUrlResponse {
  errcode?: number;
  errmsg?: string;
  upload_param?: string;
}

export interface GetConfigResponse {
  errcode?: number;
  errmsg?: string;
  typing_ticket?: string;
  route_tag?: string;
}

/** SendTyping request: uses ilink_user_id + typing_ticket + status. */
export interface SendTypingRequest {
  ilink_user_id: string;
  typing_ticket: string;
  status: number;
}

export interface QrCodeStartResponse {
  errcode?: number;
  errmsg?: string;
  qrcode?: string;
  qrcode_img_content?: string; // URL to QR code image
}

export interface QrCodeStatusResponse {
  errcode?: number;
  errmsg?: string;
  status?: 'wait' | 'scaned' | 'confirmed' | 'expired';
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

export interface WeixinCredentials {
  botToken: string;
  ilinkBotId: string;
  baseUrl: string;
  cdnBaseUrl: string;
}

/** Error code indicating the session has expired */
export const ERRCODE_SESSION_EXPIRED = -14;

/** Default base URL */
export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';

/** Default CDN base URL */
export const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
