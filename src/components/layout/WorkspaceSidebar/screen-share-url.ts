export function buildScreenShareWsUrl(bridgeUrl: string, takeover = false): string {
  const url = new URL(bridgeUrl);
  url.pathname = '/screen-share/ws';
  if (takeover) {
    url.searchParams.set('takeover', '1');
  } else {
    url.searchParams.delete('takeover');
  }
  return url.toString();
}
