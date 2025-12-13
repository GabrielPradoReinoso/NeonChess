// server.js
// -----------------------------
// Express + Socket.IO para Cloud Run / local
// -----------------------------
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// --- Config ---
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
const PORT = process.env.PORT || 8080;       // Cloud Run inyecta PORT
const REGION = process.env.REGION || "europe-west1";
const NODE_ENV = process.env.NODE_ENV || "development";

// Si tu front está en Firebase Hosting: *.web.app / *.firebaseapp.com
const defaultOrigins = PROJECT_ID
  ? [
      `https://${PROJECT_ID}.web.app`,
      `https://${PROJECT_ID}.firebaseapp.com`,
      "http://localhost:3000",
      "http://localhost:5000",
      "http://127.0.0.1:5000",
    ]
  : ["http://localhost:3000", "http://localhost:5000", "http://127.0.0.1:5000", "*"];

// Permite sobreescribir por env: ALLOWED_ORIGINS="https://foo.com,https://bar.com"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : defaultOrigins;

// --- App/Server ---
const app = express();
app.set("trust proxy", true); // Cloud Run está detrás de proxy

// Health checks
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// (Opcional) servir estáticos en local para pruebas
if (NODE_ENV !== "production") {
  app.use(express.static(path.join(__dirname, "public")));
}

// HTTP server + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  path: "/socket.io", // por defecto es /socket.io, lo dejamos explícito
  cors: {
    origin: allowedOrigins, // array de orígenes o ["*"] en dev
    methods: ["GET", "POST"],
    credentials: false,     // IMPORTANTE: false si usas origin:"*"
  },
  // transports por defecto (polling + websocket) ok para Cloud Run
});

// -----------------------------
// Estado de salas en memoria
// (para multi-instancia real: usar Firestore/Redis como store compartida)
// -----------------------------
const rooms = Object.create(null); // rooms[roomId] = { hostId, guestId, createdAt }

function makeRoomId(len = 5) {
  return Math.random().toString(36).slice(2, 2 + len);
}
function now() {
  return new Date().toISOString();
}

// -----------------------------
// Socket handlers
// -----------------------------
io.on("connection", (socket) => {
  console.log(`[${now()}] Cliente conectado: ${socket.id}`);

  socket.on("disconnect", (reason) => {
    console.log(`[${now()}] Cliente desconectado: ${socket.id} (${reason})`);
    // Limpieza de salas donde esté este socket
    for (const [roomId, info] of Object.entries(rooms)) {
      if (!info) continue;
      const isHost = info.hostId === socket.id;
      const isGuest = info.guestId === socket.id;
      if (isHost || isGuest) {
        const opponentId = isHost ? info.guestId : info.hostId;
        if (opponentId) {
          io.to(opponentId).emit("opponentLeft");
          io.sockets.sockets.get(opponentId)?.leave(roomId);
        }
        delete rooms[roomId];
        console.log(`[${now()}] Sala ${roomId} eliminada (salida de ${socket.id})`);
      }
    }
  });

  // Crear partida (host)
  socket.on("newGame", () => {
    let roomId;
    do roomId = makeRoomId();
    while (rooms[roomId]);

    rooms[roomId] = { hostId: socket.id, guestId: null, createdAt: Date.now() };
    socket.join(roomId);
    socket.emit("gameCreated", roomId);
    console.log(`[${now()}] Sala ${roomId} creada por ${socket.id}`);
  });

  // Unirse por código (guest)
  socket.on("joinGame", (roomIdRaw) => {
    const roomId = String(roomIdRaw || "").trim();
    const room = rooms[roomId];
    if (!room) {
      socket.emit("error", "Código inválido.");
      return;
    }
    if (room.guestId) {
      socket.emit("error", "La sala ya está completa.");
      return;
    }

    room.guestId = socket.id;
    socket.join(roomId);
    console.log(`[${now()}] Jugador ${socket.id} se une a ${roomId}`);

    // Colores fijos: host = blancas, guest = negras
    io.to(room.hostId).emit("startGame", { roomId, color: "w", yourTurn: true });
    io.to(room.guestId).emit("startGame", { roomId, color: "b", yourTurn: false });
  });

  
  // Movimiento del jugador (con ack)
socket.on("playerMove", ({ roomId, move }, ack) => {
  const room = rooms[roomId];
  if (!room) {
    if (typeof ack === "function") ack({ ok:false, error:"room_not_found" });
    return;
  }
  socket.to(roomId).emit("opponentMove", move);
  if (typeof ack === "function") ack({ ok:true });
});


  // Rendición
  socket.on("resign", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    socket.to(roomId).emit("opponentResigned");
  });
});

// -----------------------------
// Arranque
// -----------------------------
server.listen(PORT, () => {
  console.log(`[${now()}] Servidor escuchando en :${PORT} (region=${REGION})`);
  console.log(`[${now()}] CORS orígenes: ${Array.isArray(allowedOrigins) ? allowedOrigins.join(", ") : allowedOrigins}`);
});
