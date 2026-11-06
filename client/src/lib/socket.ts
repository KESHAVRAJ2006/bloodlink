import { io, type Socket } from "socket.io-client";
import { API_URL } from "./config";

/**
 * One socket for the whole app. React mounts and unmounts components all the
 * time, and opening a new connection in every component would flood the server.
 *
 * The URL is the same API_URL the REST calls use, so switching between the
 * local server and the deployed one is a single environment variable.
 *
 * Transports: Socket.IO normally connects with HTTP long polling first and then
 * upgrades to a WebSocket. Both are listed here, websocket first, so the
 * upgrade happens as soon as possible but the connection still works on a
 * network or proxy that blocks WebSockets - it just falls back to polling,
 * which is slower but functional.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_URL, {
      transports: ["websocket", "polling"],
      // On a free host that sleeps, the first connection can fail while the
      // instance wakes up, so keep retrying with a growing delay.
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      timeout: 20000,
    });

    if (import.meta.env.DEV) {
      socket.on("connect", () => console.log("socket connected:", socket?.id));
      socket.on("connect_error", (error) => console.warn("socket connect error:", error.message));
    }
  }
  return socket;
}
