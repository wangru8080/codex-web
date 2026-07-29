import WebSocket from "ws";

export type AppServerPeer = {
  isOpen: () => boolean;
  send: (serialized: string) => void;
  close: (code?: number, reason?: string) => void;
};

export function webSocketAppServerPeer(socket: WebSocket): AppServerPeer {
  return {
    isOpen: () => socket.readyState === WebSocket.OPEN,
    send: (serialized) => socket.send(serialized),
    close: (code, reason) => socket.close(code, reason),
  };
}
