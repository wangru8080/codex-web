import { describe, expect, it } from 'vitest';
import { isScreenShareFrameMessage } from './screen-share-frame-protocol';

describe('screen-share-frame-protocol', () => {
  it('validates ready message', () => {
    expect(isScreenShareFrameMessage({ type: 'screen-frame/ready' })).toBe(true);
  });

  it('validates status message with resolution and code', () => {
    expect(
      isScreenShareFrameMessage({
        type: 'screen-frame/status',
        state: 'connected',
        width: 1920,
        height: 1080,
      }),
    ).toBe(true);

    expect(
      isScreenShareFrameMessage({
        type: 'screen-frame/status',
        state: 'disconnected',
        code: 4003,
        reason: 'Launch failed',
      }),
    ).toBe(true);
  });

  it('validates error message', () => {
    expect(
      isScreenShareFrameMessage({
        type: 'screen-frame/error',
        message: 'connection failed',
      }),
    ).toBe(true);
  });

  it('rejects invalid messages', () => {
    expect(isScreenShareFrameMessage(null)).toBe(false);
    expect(isScreenShareFrameMessage({})).toBe(false);
    expect(isScreenShareFrameMessage({ type: 'unknown' })).toBe(false);
    expect(
      isScreenShareFrameMessage({
        type: 'screen-frame/status',
        state: 'invalid-state',
      }),
    ).toBe(false);
    expect(
      isScreenShareFrameMessage({
        type: 'screen-frame/status',
        state: 'connected',
        width: -10,
      }),
    ).toBe(false);
  });
});
