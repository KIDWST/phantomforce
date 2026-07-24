/* PhantomPlay — developer collaboration rooms.

   Ephemeral, code-based WebSocket rooms for the native PhantomPlay shell
   (packages/phantomplay-dioxus-shell). Deliberately NOT gated behind
   requireAccessSession/tenant auth like the existing HTTP-polling
   /api/phantomplay/rooms (game-multiplayer) system — this is a local dev
   collaboration tool for whoever has the code, same trust model as sharing a
   Zoom link. No persistence: rooms live in memory and vanish when empty.

   Protocol (JSON text frames both ways):
     client -> server:
       { type: "join", code, name }
       { type: "chat", text }
       { type: "signal", to, data }        // WebRTC offer/answer/ICE relay
       { type: "file-sync", path, content } // broadcast a saved file to peers
     server -> client:
       { type: "joined", clientId, members: [{clientId, name}] }
       { type: "presence", members: [{clientId, name}] }
       { type: "chat", clientId, name, text, at }
       { type: "signal", from, data }
       { type: "file-sync", from, path, content, at }
       { type: "error", message }
*/

import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

type Member = { clientId: string; name: string; socket: WebSocket };
type Room = { code: string; createdAt: number; members: Map<string, Member> };

const MAX_ROOM_MEMBERS = 12;
const MAX_CHAT_CHARS = 2000;
const MAX_FILE_SYNC_CHARS = 2_000_000;

const rooms = new Map<string, Room>();

function roomMembers(room: Room) {
  return Array.from(room.members.values()).map((m) => ({ clientId: m.clientId, name: m.name }));
}

function broadcast(room: Room, payload: unknown, exceptClientId?: string) {
  const text = JSON.stringify(payload);
  for (const member of room.members.values()) {
    if (member.clientId === exceptClientId) continue;
    if (member.socket.readyState === member.socket.OPEN) member.socket.send(text);
  }
}

function sanitizeName(raw: unknown) {
  const name = typeof raw === "string" ? raw.trim().slice(0, 40) : "";
  return name || `dev-${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeDevRoomCode(raw: unknown) {
  const code = typeof raw === "string" ? raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  return code.slice(0, 12);
}

export function createDevRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1 confusion
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export function devRoomStats() {
  return { rooms_open: rooms.size, members_connected: Array.from(rooms.values()).reduce((n, r) => n + r.members.size, 0) };
}

export function registerPhantomPlayDevRooms(app: FastifyInstance) {
  app.get("/ws/phantomplay/devroom/:code", { websocket: true }, (socket, request) => {
    const params = request.params as { code?: string };
    const code = normalizeDevRoomCode(params.code);
    if (!code) {
      socket.send(JSON.stringify({ type: "error", message: "A room code is required." }));
      socket.close();
      return;
    }

    let room = rooms.get(code);
    if (!room) {
      room = { code, createdAt: Date.now(), members: new Map() };
      rooms.set(code, room);
    }
    if (room.members.size >= MAX_ROOM_MEMBERS) {
      socket.send(JSON.stringify({ type: "error", message: "This dev room is full." }));
      socket.close();
      return;
    }

    const clientId = randomUUID();
    let joined = false;

    socket.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const currentRoom = rooms.get(code);
      if (!currentRoom) return;

      if (msg.type === "join" && !joined) {
        joined = true;
        const name = sanitizeName(msg.name);
        currentRoom.members.set(clientId, { clientId, name, socket });
        socket.send(JSON.stringify({ type: "joined", clientId, members: roomMembers(currentRoom) }));
        broadcast(currentRoom, { type: "presence", members: roomMembers(currentRoom) }, clientId);
        return;
      }
      if (!joined) return; // ignore everything else until join

      const member = currentRoom.members.get(clientId);
      if (!member) return;

      if (msg.type === "chat") {
        const text = typeof msg.text === "string" ? msg.text.slice(0, MAX_CHAT_CHARS) : "";
        if (!text) return;
        broadcast(currentRoom, { type: "chat", clientId, name: member.name, text, at: Date.now() });
        return;
      }
      if (msg.type === "signal") {
        const to = typeof msg.to === "string" ? currentRoom.members.get(msg.to) : undefined;
        if (to && to.socket.readyState === to.socket.OPEN) {
          to.socket.send(JSON.stringify({ type: "signal", from: clientId, data: msg.data }));
        }
        return;
      }
      if (msg.type === "file-sync") {
        const path = typeof msg.path === "string" ? msg.path.slice(0, 500) : "";
        const content = typeof msg.content === "string" ? msg.content.slice(0, MAX_FILE_SYNC_CHARS) : "";
        if (!path) return;
        broadcast(currentRoom, { type: "file-sync", from: clientId, path, content, at: Date.now() }, clientId);
        return;
      }
    });

    const leave = () => {
      const currentRoom = rooms.get(code);
      if (!currentRoom) return;
      currentRoom.members.delete(clientId);
      if (currentRoom.members.size === 0) {
        rooms.delete(code);
      } else {
        broadcast(currentRoom, { type: "presence", members: roomMembers(currentRoom) });
      }
    };
    socket.on("close", leave);
    socket.on("error", leave);
  });

  app.post("/api/phantomplay/devroom/new-code", async () => {
    let code = createDevRoomCode();
    while (rooms.has(code)) code = createDevRoomCode();
    return { ok: true, code };
  });
}
