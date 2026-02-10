// server.js
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 8080;
const NODE_ENV = process.env.NODE_ENV || "development";

const app = express();
app.set("trust proxy", true);

app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

const BUILD_STAMP = new Date().toISOString();

app.get("/__whoami", (_req, res) => {
  res.status(200).json({
    ok: true,
    buildStamp: BUILD_STAMP,
    nodeEnv: process.env.NODE_ENV || null,
    port: process.env.PORT || null,
  });
});


if (NODE_ENV !== "production") {
  app.use(express.static(path.join(__dirname, "public")));
}

const server = http.createServer(app);

// CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Si no pasas ALLOWED_ORIGINS, abre en local
const corsOrigin =
  allowedOrigins.length > 0
    ? allowedOrigins
    : ["http://localhost:3000", 
      "http://localhost:5000",
      "http://127.0.0.1:56337",
];

const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"],
    credentials: false,
  },
  pingInterval: 25000,
  pingTimeout: 120000,
});

// =============================
// Estado en memoria (1v1)
// =============================
const rooms = Object.create(null);

// tiempo de gracia antes de destruir sala por desconexión
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS || 60000);

function makeRoomId(len = 5) {
  return Math.random().toString(36).slice(2, 2 + len);
}
function now() {
  return new Date().toISOString();
}

function getOpponentId(room, socketId) {
  if (!room) return null;
  if (room.hostId === socketId) return room.guestId || null;
  if (room.guestId === socketId) return room.hostId || null;
  return null;
}

function emitOpponentStatus(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // Si solo hay un jugador aún, no tiene sentido “opponentStatus”
  if (!room.hostId || !room.guestId) return;

  const hostOnline = !!room.hostOnline;
  const guestOnline = !!room.guestOnline;

  // Para el host, “rival online” es guestOnline
  io.to(room.hostId).emit("opponentStatus", { online: guestOnline, roomId });

  // Para el guest, “rival online” es hostOnline
  io.to(room.guestId).emit("opponentStatus", { online: hostOnline, roomId });
}

function scheduleRoomCleanup(roomId, reason = "disconnect") {
  const room = rooms[roomId];
  if (!room) return;

  // Si ya hay timer, no dupliques
  if (room.cleanupTimer) return;

  room.cleanupTimer = setTimeout(() => {
    const r = rooms[roomId];
    if (!r) return;

    // Si alguien volvió online, cancelamos cleanup
    const someoneOnline = !!r.hostOnline || !!r.guestOnline;
    if (someoneOnline) {
      clearTimeout(r.cleanupTimer);
      r.cleanupTimer = null;
      return;
    }

    // Ya nadie está online -> destruimos la sala
    const hostId = r.hostId;
    const guestId = r.guestId;

    // Aviso final al que quede (por si acaso)
    if (hostId) io.to(hostId).emit("opponentLeft", { roomId });
    if (guestId) io.to(guestId).emit("opponentLeft", { roomId });

    delete rooms[roomId];
    console.log(`[${now()}] sala ${roomId} eliminada (${reason})`);
  }, DISCONNECT_GRACE_MS);
}

// =============================
// Socket.IO
// =============================
io.on("connection", (socket) => {

  socket.emit("serverInfo", {
    revision: process.env.K_REVISION || null,
    service: process.env.K_SERVICE || null,
    build: BUILD_STAMP,
    ts: Date.now(),
    socketId: socket.id,
  });


  console.log(`[${now()}] conectado: ${socket.id}`);

  socket.on("disconnect", (reason) => {
    console.log(`[${now()}] desconectado: ${socket.id} (${reason})`);

    // Marca offline en las salas donde esté
    for (const [roomId, room] of Object.entries(rooms)) {
      if (!room) continue;

      const isHost = room.hostId === socket.id;
      const isGuest = room.guestId === socket.id;
      if (!isHost && !isGuest) continue;

      if (isHost) room.hostOnline = false;
      if (isGuest) room.guestOnline = false;

      // Notifica a ambos el estado del rival
      emitOpponentStatus(roomId);

      // IMPORTANTE: NO borramos la sala en desconexiones temporales
      scheduleRoomCleanup(roomId, `disconnect:${reason}`);

      // Por claridad (no hace daño): salir de la room
      socket.leave(roomId);
    }
  });

  socket.on("ping_test", (payload, ack) => {
    console.log("[ping_test] from", socket.id, payload);
    ack?.({ ok: true, t: Date.now() });
  });

  // Crear partida (host)
  socket.on("newGame", () => {
    let roomId;
    do roomId = makeRoomId();
    while (rooms[roomId]);

    rooms[roomId] = {
      hostId: socket.id,
      guestId: null,

      hostOnline: true,
      guestOnline: false,

      createdAt: Date.now(),

      seq: 0,
      moves: [],
      seenMoveIds: new Set(),

      cleanupTimer: null,
    };

    socket.join(roomId);
    console.log("[room] host joined", { roomId, socketId: socket.id });

    socket.emit("gameCreated", roomId);
    console.log(`[${now()}] sala creada ${roomId} por ${socket.id}`);
  });

  // Unirse por código (guest)
  socket.on("joinGame", (roomIdRaw) => {
    const roomId = String(roomIdRaw || "").trim();
    const room = rooms[roomId];

    if (!room) return socket.emit("error", "Código inválido.");
    if (room.guestId) return socket.emit("error", "La sala ya está completa.");

    room.guestId = socket.id;
    room.guestOnline = true;

    // si existía cleanup pendiente (host pudo desconectarse)
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }

    socket.join(roomId);
    console.log("[room] guest joined", { roomId, socketId: socket.id });

    // host = w, guest = b
    io.to(room.hostId).emit("startGame", {
      roomId,
      color: "w",
      yourTurn: true,
    });
    io.to(room.guestId).emit("startGame", {
      roomId,
      color: "b",
      yourTurn: false,
    });

    // Presencia: avisar a ambos (para cada uno, si el rival está online)
    emitOpponentStatus(roomId);

    console.log(`[${now()}] ${socket.id} se une a ${roomId}`);
  });

  // Movimiento con ACK + dedupe + seq
  socket.on("playerMove", ({ roomId, move }, ack) => {
    const room = rooms[roomId];
    if (!room) return ack?.({ ok: false, error: "room_not_found" });

    const id = move?.id;
    if (!id) return ack?.({ ok: false, error: "missing_move_id" });

    // Dedupe
    if (room.seenMoveIds.has(id)) {
      return ack?.({ ok: true, dup: true, seq: room.seq });
    }
    room.seenMoveIds.add(id);

    room.seq += 1;
    const payload = { ...move, seq: room.seq };
    room.moves.push(payload);

    // Enviar al rival (el que no es socket)
    socket.to(roomId).emit("opponentMove", payload);
    ack?.({ ok: true, seq: payload.seq });
  });

  // Sync para recuperar huecos
  socket.on("syncRequest", ({ roomId, lastSeq }, ack) => {
    const room = rooms[roomId];
    if (!room) return ack?.({ ok: false, error: "room_not_found" });

    const fromSeq = Number(lastSeq || 0);
    const missing = room.moves.filter((m) => (m.seq || 0) > fromSeq);

    ack?.({ ok: true, moves: missing, serverSeq: room.seq });
  });

  // ============================================================
  // CHAT MESSAGE (room broadcast + fallback directo a host/guest)
  // ============================================================
  socket.on("chatMessage", (payload = {}, ack) => {
    console.log("[chatMessage] HIT", {
      socketId: socket.id,
      roomId: payload?.roomId,
      hasAck: typeof ack === "function",
      textLen: String(payload?.text || "").length,
    });

    try {
      const roomId = String(payload.roomId || "").trim();
      const text = String(payload.text || "").trim();
      const id = payload.id ? String(payload.id) : null;
      const ts = Number.isFinite(payload.ts) ? payload.ts : Date.now();

      if (!roomId || !text) {
        console.warn("[chatMessage] bad_payload", { roomId, textLen: text.length });
        ack?.({ ok: false, error: "bad_payload" });
        return;
      }

      const room = rooms[roomId];
      if (!room) {
        console.warn("[chatMessage] room_not_found", roomId);
        ack?.({ ok: false, error: "room_not_found" });
        return;
      }

      const msg = {
        roomId,
        id: id || `${ts}-${Math.random().toString(16).slice(2)}`,
        text,
        ts,
        from: socket.id,
      };

      // ✅ EMITE A TODA LA ROOM (NO a hostId/guestId)
      console.log("[chatMessage] broadcasting to room:", roomId);
      io.to(roomId).emit("chatMessage", msg);

      // ✅ ACK SIEMPRE
      ack?.({ ok: true });
    } catch (err) {
      console.error("[chatMessage] error:", err);
      ack?.({ ok: false, error: "server_error" });
    }
  });

  // ============================================================
  // REJOIN ROOM (reconexión / refresh)
  // ============================================================
  socket.on("rejoinRoom", ({ roomId } = {}) => {
    try {
      const rid = String(roomId || "").trim();
      if (!rid) return;

      const room = rooms[rid];

      // Únete SIEMPRE a la room de Socket.IO
      socket.join(rid);

      // Si existe la sala en memoria, actualiza presencia y cancela cleanup
      if (room) {
        if (room.cleanupTimer) {
          clearTimeout(room.cleanupTimer);
          room.cleanupTimer = null;
        }

        // Marca online si este socket es host/guest
        if (room.hostId === socket.id) room.hostOnline = true;
        if (room.guestId === socket.id) room.guestOnline = true;

        // (Opcional pero útil) si alguien cambió de socket.id por reconnect,
        // aquí NO lo puedes “re-asignar” sin una identidad estable (token).
        // Por eso el fallback del chat es importante.
        emitOpponentStatus(rid);
      }

      socket.emit("rejoinAck", { ok: true, roomId: rid });
    } catch (err) {
      console.error("[rejoinRoom] error:", err);
      socket.emit("rejoinAck", { ok: false });
    }
  });

  // Rendición
  socket.on("resign", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    socket.to(roomId).emit("opponentResigned", { roomId });

    // Opcional: limpiar sala rápido tras rendición (sin esperar grace)
    // Marcamos ambos offline y programamos cleanup corto
    room.hostOnline = false;
    room.guestOnline = false;
    emitOpponentStatus(roomId);

    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    // Limpieza rápida (2s) para liberar memoria
    room.cleanupTimer = setTimeout(() => {
      if (!rooms[roomId]) return;
      delete rooms[roomId];
      console.log(`[${now()}] sala ${roomId} eliminada (resign)`);
    }, 2000);
  });
});

server.listen(PORT, () => {
  console.log(`[${now()}] escuchando en :${PORT}`);
  console.log(
    `[${now()}] CORS: ${
      Array.isArray(corsOrigin) ? corsOrigin.join(", ") : corsOrigin
    }`
  );
});