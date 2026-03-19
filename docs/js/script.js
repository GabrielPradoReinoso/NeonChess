// js/script.js

// ============================================================
// NEON CHESS - Script principal
// ============================================================

// ============================================================
// ÍNDICE DE BLOQUES (ACTUALIZACIÓN RECIENTE: 20/01/2026 13:30)
// ============================================================
/*
 0) BASE: helpers, estado global, locks y utilidades
 1) STOCKFISH: worker + helpers UCI
 2) ONLINE: Socket.IO + salas + sync + cola + conexión
 3) UI SETUP: dropdowns (dificultad/color/tiempo) + overlays
 4) AUDIO: música + pools + SFX + botones
 5) UI GENERAL: menú header + helpers DOM/estilos
 6) TABLERO: generación, coordenadas, render
 7) REGLAS: validación movimientos, ataques, jaque/mate/tablas
 8) ANIMACIONES: movimiento piezas + capturas + VFX
 9) INPUT: click en celda + drag & drop
10) PARTIDA: finishMove, timers, turn LEDs, scores, salud
11) HISTORIAL: snapshots + navegación + UI movimientos
12) INICIO/RESET: start, repeat, reset, beforeunload
13) CHAT: UI + submit + renderer
14) STOCKFISH: request + bestmove handling
15) STARTERS: actuallyStartGame + playButton + init timers
16) ARRANQUE GLOBAL (DOMContentLoaded)
*/

// ============================================================
// 0) ARRANQUE + HELPERS BASE + ESTADO GLOBAL
// ============================================================

"use strict";

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

const DEBUG = false;

// Helpers DOM
function $(id) {
  return document.getElementById(id);
}

function $$(sel) {
  return Array.from(document.querySelectorAll(sel));
}

function addEventMulti(el, events, handler) {
  if (!el) return;
  events.forEach((evt) => el.addEventListener(evt, handler, false));
}

// Esperar a que la UI cargue para mostrar contenido
function waitForWindowLoad() {
  return new Promise((resolve) => {
    if (document.readyState === "complete") {
      resolve();
      return;
    }
    window.addEventListener("load", resolve, { once: true });
  });
}

function waitForFontsReady() {
  if (document.fonts && document.fonts.ready) {
    return document.fonts.ready.catch(() => {});
  }
  return Promise.resolve();
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function revealAppWhenStable() {
  await waitForWindowLoad();
  await waitForFontsReady();

  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  await nextFrame();
  await nextFrame();

  if (loadingOverlay) {
    loadingOverlay.remove();

    document.body.classList.remove("app-loading");
    document.body.classList.add("app-ready");
    document.body.classList.remove("loading-lock");

    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  } else {
    document.body.classList.remove("app-loading");
    document.body.classList.add("app-ready");
    document.body.classList.remove("loading-lock");

    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  }
}

// Fondo animado página principal
function initAnimatedBackground() {
  const container = document.getElementById("animated-bg");
  if (!container) return;

  container.innerHTML = "";

  const NUM_FILLED = 8;
  const NUM_OUTLINED = 8;

  function createSquare(type = "fill") {
    const square = document.createElement("div");
    square.classList.add("bg-square", type);

    const size =
      type === "outline"
        ? 50 + Math.random() * 130
        : 35 + Math.random() * 110;

    square.style.width = size + "px";
    square.style.height = size + "px";

    square.style.left = Math.random() * 100 + "vw";

    // Arrancan antes: delays mucho más bajos y algunos negativos
    const duration = 12 + Math.random() * 16;
    const delay = -Math.random() * 8;

    square.style.animationDuration = duration + "s";
    square.style.animationDelay = delay + "s";

    if (type === "fill") {
      square.style.opacity = 0.12 + Math.random() * 0.18;
    } else {
      square.style.opacity = 0.25 + Math.random() * 0.35;
    }

    // ligera variación vertical inicial
    square.style.setProperty("--drift-x", `${-30 + Math.random() * 60}px`);
    square.style.setProperty("--drift-rot", `${-12 + Math.random() * 24}deg`);

    container.appendChild(square);
    const isStrong = Math.random() < 0.25;

    if (isStrong) {
      square.style.opacity = type === "fill"
        ? 0.35 + Math.random() * 0.2
        : 0.5 + Math.random() * 0.3;

      square.style.filter = "brightness(1.4)";
    }
  }

  for (let i = 0; i < NUM_FILLED; i++) createSquare("fill");
  for (let i = 0; i < NUM_OUTLINED; i++) createSquare("outline");
}

// Estado juego
let board = [];
let selectedCell = null;
let lastMoveCells = [];

let currentTurn = "w";
let humanColor = "w";

let isReviewMode = false;
let isNavigating = false;
let hasGameStartedFromMenu = false;

// Online
let isOnlineGame = false;
let currentRoomId = null;

let onlineMoveQueue = [];
let processingQueue = false;

const seenMoveIds = new Set();
const MAX_MOVE_IDS = 300;
function rememberMoveId(id) {
  if (!id) return;
  seenMoveIds.add(id);
  if (seenMoveIds.size > MAX_MOVE_IDS) {
    const first = seenMoveIds.values().next().value;
    seenMoveIds.delete(first);
  }
}
let lastAppliedSeq = 0;

// Castling / EP
let kingMoved = { w: false, b: false };
let rookMoved = {
  w: { left: false, right: false },
  b: { left: false, right: false },
};
let enPassantTarget = null;

// Historial
let positionHistory = [];
let currentHistoryIndex = 0;
const repetitionCount = new Map();
// Historial UI (lista de movimientos)
let moveList = []; // {from,to,piece,capture,ts}

// Scores / salud
const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const kingBaseHealth = 5;
let maxHealth = { w: 39 + kingBaseHealth, b: 39 + kingBaseHealth };
let currentHealth = { ...maxHealth };
let scores = { w: 0, b: 0 };

// Timers
let timers = {};
let timerIntervals = {};
let lastTick = { w: 0, b: 0 };

// Lock animación (este es EL lock real del juego)
let isAnimating = false;

// Congela input (CSS hook). No bloquea render.
function setBoardAnimating(on) {
  const boardEl = $("chessBoard");
  if (!boardEl) return;
  boardEl.classList.toggle("board-animating", !!on);
}

function startAnimationLock() {
  isAnimating = true;
  setBoardAnimating(true);
}
function endAnimationLock() {
  isAnimating = false;
  setBoardAnimating(false);
}

// Indicador conexión (si existe en HTML)
const connStatus = $("connStatus");
const connText = $("connText");

function setConn(state) {
  // Estado global del indicador (solo se ve en online)
  if (!isOnlineGame) return;
  if (state === "online") return setOpponentConn("online");
  if (state === "reconnecting") return setOpponentConn("reconnecting");
  return setOpponentConn("offline");
}

function setOpponentConn(state) {
  // ✅ En local vs robot NO debe mostrarse nunca
  if (!isOnlineGame) return;

  const status = $("connStatus");
  const textEl = $("connText");
  if (!status || !textEl) return;

  textEl.textContent =
    state === "online"
      ? "Rival conectado"
      : state === "reconnecting"
        ? "Buscando rival…"
        : "Rival desconectado";

  status.classList.remove("online", "offline", "reconnecting", "hidden");
  status.classList.add(state);

  const dot = status.querySelector(".conn-dot");
  if (dot) {
    dot.classList.remove("online", "offline", "reconnecting");
    dot.classList.add(state);
  }
}

function refreshConnVisibility() {
  const el = $("connStatus");
  if (!el) return;

  if (isOnlineGame) el.classList.remove("hidden");
  else el.classList.add("hidden");
}

// Algebraic helpers (online)
function algebraicToRC(sq) {
  const files = "abcdefgh";
  const col = files.indexOf(sq[0]);
  const row = 8 - parseInt(sq[1], 10);
  return { row, col };
}
function rcToAlgebraic(pos) {
  const files = "abcdefgh";
  return files[pos.col] + (8 - pos.row);
}

function copyTextToClipboard(text) {
  const str = String(text || "").trim();
  if (!str) return Promise.reject(new Error("Nada que copiar"));

  // API moderna (https)
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(str);
  }

  // Fallback
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = str;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand("copy");
      ta.remove();
      ok ? resolve() : reject(new Error("execCommand(copy) falló"));
    } catch (e) {
      reject(e);
    }
  });
}

function enterReviewMode() {
  if (isReviewMode) return;
  isReviewMode = true;
  isNavigating = true;
  stopTimer("w");
  stopTimer("b");
}

function exitReviewMode() {
  if (!isReviewMode) return;
  isReviewMode = false;
  isNavigating = false;

  // timers: estaban parados por enterReviewMode()
  if (Number.isFinite(timers[currentTurn])) startTimer(currentTurn);
}

function maybeExitReviewAtEnd() {
  if (currentHistoryIndex === positionHistory.length - 1) {
    exitReviewModeToLiveGame(); // limpia estado / UI
    exitReviewMode(); // reanuda timers si procede
    setTurnLED?.();
  }
}

function exitReviewModeToLiveGame() {
  isReviewMode = false;
  isNavigating = false;

  // unlock coherente (estado + CSS)
  try {
    endAnimationLock?.();
  } catch {}

  try {
    removeMoveIndicators?.();
  } catch {}
  try {
    document
      .querySelectorAll(".cell.selected")
      .forEach((c) => c.classList.remove("selected"));
  } catch {}
  selectedCell = null;

  updateKingStatus?.();
  renderBoard?.();
}

function scrollMoveHistoryToEnd(smooth = true) {
  const hist = document.querySelector(".move-history");
  if (!hist) return;

  // Si el usuario está navegando/review, NO lo forces al final
  if (isNavigating || isReviewMode) return;

  const left = hist.scrollWidth - hist.clientWidth;
  hist.scrollTo({
    left: Math.max(0, left),
    behavior: smooth ? "smooth" : "auto",
  });
}

// ============================================================
// 1) STOCKFISH: worker + helpers UCI
// ============================================================

let stockfishWorker = null;

// Mapping (igual que tu versión)
const skillMapping = [0, 4, 8, 12, 14, 16, 18, 19, 20, 20];
const movetimeMapping = [
  500, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500,
];

function getSkillForLevel(level) {
  level = Math.max(1, Math.min(10, level));
  return skillMapping[level - 1];
}
function getMovetimeForLevel(level) {
  level = Math.max(1, Math.min(10, level));
  return movetimeMapping[level - 1];
}

function initStockfish() {
  if (stockfishWorker) stockfishWorker.terminate();

  // ✅ Mantiene tu enfoque con import.meta.url
  const workerUrl = new URL("./stockfish-worker.js", import.meta.url);
  DEBUG && console.log("[SF] workerUrl =", workerUrl.href);

  try {
    stockfishWorker = new Worker(workerUrl);
  } catch (e) {
    console.error("[SF] new Worker() FAILED:", e);
    stockfishWorker = null;
    return;
  }

  stockfishWorker.onmessage = (e) => {
    const msg = typeof e.data === "string" ? e.data : e.data?.bestmove;
    DEBUG && console.log("[SF]", msg);

    if (typeof msg === "string" && msg.startsWith("bestmove")) {
      const best = msg.split(" ")[1];
      if (best) processBestMove(best);
    }
  };

  stockfishWorker.onerror = (err) => console.error("[SF] Worker error:", err);
  stockfishWorker.onmessageerror = (err) =>
    console.error("[SF] Worker message error:", err);
}

// ============================================================
// 2) ONLINE: Socket.IO + salas + sync + cola + conexión
// ============================================================

// Entorno
const isHosting =
  location.hostname.endsWith(".web.app") ||
  location.hostname.endsWith(".firebaseapp.com");

const IS_GITHUB_PAGES = location.hostname.endsWith("github.io");

// URLs (mantén tus valores)
const CLOUD_RUN_URL = "https://chess-socket-948127788089.europe-west1.run.app";
const LOCAL_SOCKET_URL = "http://localhost:8080";

// Socket singleton
let socket = null;

// Desconecta y limpia el socket (al salir de modo online)
function teardownSocket() {
  try {
    if (socket) {
      socket.removeAllListeners?.();
      socket.disconnect?.();
    }
  } catch (_) {}
  socket = null;
}

// Throttle sync (evita inundar)
let __syncCooldown = 0;
function requestSyncThrottled() {
  const now = Date.now();
  if (now - __syncCooldown < 600) return;
  __syncCooldown = now;
  requestSync();
}

// ----------------------------
// ensureSocket() (central)
// ----------------------------
function ensureSocket() {
  console.log("[io] ensureSocket called");

  // Ya existe
  if (socket) return socket;

  // Bloqueo GitHub Pages (si lo mantienes así)
  if (IS_GITHUB_PAGES) {
    console.warn("[io] GitHub Pages: online deshabilitado");
    return null;
  }

  const url = isHosting ? CLOUD_RUN_URL : LOCAL_SOCKET_URL;

  socket = io(url, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 20000,
  });

  // ✅ Exponer para depuración desde consola
  window.socket = socket;

  // ✅ Ping test correcto (NO window.__socket)
  socket.emit("ping_test", { hello: "x" }, function (ack) {
    console.log("PING_ACK", ack);
  });

  // Info del servidor (si tu backend lo emite)
  socket.on("serverInfo", function (info) {
    console.log("[serverInfo]", info);
  });

  // ✅ DEBUG GLOBAL: onAny puede no existir según types/linter
  if (typeof socket.onAny === "function") {
    socket.onAny(function (event) {
      const args = Array.prototype.slice.call(arguments, 1);
      console.log("[io:any]", event, args);
    });
  } else {
    console.warn("[io] socket.onAny no disponible (ok).");
  }

  // ============================================================
  // Conexión / reconexión
  // ============================================================
  socket.on("connect", function () {
    console.log("[io] connect:", socket.id, "room:", currentRoomId);
    console.log("CLIENT socket", socket.id);

    if (isOnlineGame) setOpponentConn("reconnecting");

    // Rejoin + sync si ya estabas en una room
    if (isOnlineGame && currentRoomId) {
      socket.emit("rejoinRoom", { roomId: currentRoomId });
      requestSyncThrottled();
    }

    socket.emit("ping_test", { hello: "world" }, function (ack) {
      console.log("[PING_TEST ACK]", ack);
    });
  });

  socket.on("disconnect", function (reason) {
    console.warn("[io] disconnect:", reason);
    setOpponentConn("offline");

    const btnCreateRoom = $("btnCreateRoom");
    const btnJoinRoom = $("btnJoinRoom");
    if (btnCreateRoom) btnCreateRoom.disabled = false;
    if (btnJoinRoom) btnJoinRoom.disabled = false;
  });

  socket.on("connect_error", function (err) {
    console.warn("[io] connect_error:", err && err.message ? err.message : err);
    setOpponentConn("reconnecting");
  });

  // Reconexión (si existe socket.io manager)
  if (socket.io && typeof socket.io.on === "function") {
    socket.io.on("reconnect_attempt", function () {
      if (isOnlineGame) setOpponentConn("reconnecting");
    });
  }

  // ============================================================
  // Errores semánticos del server
  // ============================================================
  socket.on("error", function (msg) {
    console.warn("[ON] server error:", msg);
    alert(msg);

    const btnCreateRoom = $("btnCreateRoom");
    const btnJoinRoom = $("btnJoinRoom");
    if (btnCreateRoom) btnCreateRoom.disabled = false;
    if (btnJoinRoom) btnJoinRoom.disabled = false;
  });

  // ============================================================
  // Crear sala
  // ============================================================
  socket.on("gameCreated", function (roomId) {
    console.log("[ON] gameCreated", roomId);

    currentRoomId = String(roomId || "").trim();

    const createdRoomBox = $("createdRoom");
    const roomCodeText = $("roomCodeText");
    const btnCreateRoom = $("btnCreateRoom");

    if (createdRoomBox) createdRoomBox.classList.remove("hidden");
    if (roomCodeText) roomCodeText.textContent = currentRoomId;
    if (btnCreateRoom) btnCreateRoom.disabled = false;
  });

  // ============================================================
  // Inicio partida
  // ============================================================
  socket.on("startGame", function (payload) {
    const roomId = payload && payload.roomId ? payload.roomId : "";
    const color = payload && payload.color ? payload.color : "w";

    console.log("[ON] startGame", roomId, color);

    // --- estado online ---
    isOnlineGame = true;
    currentRoomId = String(roomId || "").trim();
    humanColor = color === "b" ? "b" : "w";
    currentTurn = "w";

    console.log("[CHAT] room set", {
      currentRoomId: currentRoomId,
      socketId: socket ? socket.id : null,
    });

    // Persistencia
    localStorage.setItem("NEONCHESS_ROOM", currentRoomId);
    localStorage.setItem("NEONCHESS_ONLINE", "1");

    // Rejoin explícito (robusto en refresh/reconnect)
    try {
      socket.emit("rejoinRoom", { roomId: currentRoomId });
    } catch (e) {
      console.warn("[ON] rejoinRoom emit failed", e);
    }

    // --- UI navegación ---
    const mainSection = $("mainSection");
    const onlineChoice = $("onlineChoice");
    const onlineLobby = $("onlineLobby");
    const gameContainer = $("gameContainer");
    const chessContainer = document.querySelector(".chess-container");

    if (mainSection) mainSection.style.display = "none";
    if (onlineChoice) onlineChoice.classList.add("hidden");
    if (onlineLobby) onlineLobby.classList.add("hidden");

    const gameSetup = $("gameSetup");
    if (gameSetup) {
      gameSetup.classList.add("hidden");
      gameSetup.style.display = "none";
    }

    const header = document.querySelector("header");
    if (header) {
      document.documentElement.style.setProperty(
        "--header-height",
        `${header.offsetHeight}px`
      );
    }

    if (header) header.classList.add("hidden");
    document.body.classList.add("game-active");

    if (gameContainer) gameContainer.classList.remove("hidden");
    if (chessContainer) chessContainer.classList.remove("hidden");
    document.querySelector(".move-history-wrapper")?.classList.remove("hidden");

    // Chat visible en online
    const chatPanel = $("chatPanel");
    const chatMessages = $("chatMessages");
    if (chatPanel) chatPanel.classList.remove("hidden");
    if (chatMessages) chatMessages.innerHTML = "";

    // Música
    try {
      if (window.menuMusic && typeof window.menuMusic.pause === "function")
        window.menuMusic.pause();
      if (typeof window.playGameMusic === "function") window.playGameMusic();
    } catch (_) {}

    // Indicador conexión / robot diff
    const connStatus = $("connStatus");
    const robotDifficulty = $("robotDifficulty");
    if (connStatus) connStatus.classList.remove("hidden");
    if (robotDifficulty) robotDifficulty.classList.add("hidden");

    // Arranca partida
    actuallyStartGame();

    // Sync inicial por si hay huecos
    requestSyncThrottled();

    // Turn LED
    setTurnLED();
  });

  // ============================================================
  // Movimiento del rival
  // ============================================================
  socket.on("opponentMove", function (mv) {
    try {
      if (!mv) return;

      const moveId = mv.id || mv.from + "-" + mv.to + "-" + (mv.seq || "");
      if (seenMoveIds.has(moveId)) return;
      rememberMoveId(moveId);

      const seq = mv.seq || 0;
      if (seq) {
        if (lastAppliedSeq && seq > lastAppliedSeq + 1) {
          console.warn("[ON] hueco detectado", {
            lastAppliedSeq: lastAppliedSeq,
            seq: seq,
          });
          requestSyncThrottled();
        }
        lastAppliedSeq = Math.max(lastAppliedSeq, seq);
      }

      enqueueOnlineMove(mv);
    } catch (err) {
      console.error("[ON] opponentMove handler error:", err, mv);
      requestSyncThrottled();
    }
  });

  // ============================================================
  // Chat receive
  // ============================================================
  socket.on("chatMessage", function (msg) {
    console.log("[CHAT] recv", msg, {
      mySocketId: socket ? socket.id : null,
      room: currentRoomId,
    });
    appendChatMessage(msg);
  });

  // ============================================================
  // Eventos de sala
  // ============================================================
  socket.on("opponentStatus", function (payload) {
    const online = payload && payload.online;
    setOpponentConn(online ? "online" : "offline");
  });

  socket.on("opponentLeft", function () {
    setOpponentConn("offline");
    stopTimer("w");
    stopTimer("b");
    showEndGameModal("El rival se ha desconectado. La partida ha finalizado.");
  });

  socket.on("opponentResigned", function () {
    setOpponentConn("offline");
    stopTimer("w");
    stopTimer("b");
    showEndGameModal("Tu rival se rindió. Fin de la partida.");
  });

  return socket;
}

// ----------------------------
// Sync request
// ----------------------------
function requestSync() {
  if (!isOnlineGame || !currentRoomId) return;
  const s = ensureSocket();
  if (!s) return;

  s.emit(
    "syncRequest",
    { roomId: currentRoomId, lastSeq: lastAppliedSeq },
    (res) => {
      if (!res?.ok) return;

      const moves = res.moves || [];
      moves.sort((a, b) => (a.seq || 0) - (b.seq || 0));

      for (const mv of moves) {
        const moveId = mv.id || `${mv.from}-${mv.to}-${mv.seq || ""}`;
        if (seenMoveIds.has(moveId)) continue;

        rememberMoveId(moveId);
        lastAppliedSeq = Math.max(lastAppliedSeq, mv.seq || lastAppliedSeq);
        enqueueOnlineMove(mv);
      }
    },
  );
}

// ----------------------------
// Cola online robusta
// ----------------------------
function enqueueOnlineMove(move) {
  onlineMoveQueue.push(move);
  processOnlineMoveQueue();
}

function processOnlineMoveQueue() {
  if (processingQueue || isAnimating) return;

  const next = onlineMoveQueue.shift();
  if (!next) return;

  processingQueue = true;

  // Liberación garantizada
  let released = false;
  const releaseAndContinue = () => {
    if (released) return;
    released = true;
    processingQueue = false;
    setTimeout(processOnlineMoveQueue, 0);
  };

  const from =
    typeof next.from === "string" ? algebraicToRC(next.from) : next.from;
  const to = typeof next.to === "string" ? algebraicToRC(next.to) : next.to;

  const validPos =
    from &&
    to &&
    Number.isInteger(from.row) &&
    Number.isInteger(from.col) &&
    Number.isInteger(to.row) &&
    Number.isInteger(to.col) &&
    from.row >= 0 &&
    from.row < 8 &&
    from.col >= 0 &&
    from.col < 8 &&
    to.row >= 0 &&
    to.row < 8 &&
    to.col >= 0 &&
    to.col < 8;

  if (!validPos) {
    console.warn("[ON] Movimiento inválido (coords)", next);
    releaseAndContinue();
    return;
  }

  // Wrap finishMove SOLO para este movimiento (evita cuelgues si hay errores)
  const prevFinishMove = finishMove;
  finishMove = function wrappedFinishMove() {
    try {
      return prevFinishMove();
    } finally {
      finishMove = prevFinishMove;
      releaseAndContinue();
    }
  };

  try {
    // movimiento recibido => NO es humano
    movePiece(from, to, false, next.promotion || null);
  } catch (err) {
    console.error("[ON] movePiece explotó:", err, next);
    finishMove = prevFinishMove;
    releaseAndContinue();
  }

  // watchdog (si movePiece ignora y no llama finishMove)
  setTimeout(() => {
    if (processingQueue && !isAnimating) {
      finishMove = prevFinishMove;
      console.warn(
        "[ON] watchdog: finishMove no se llamó; liberando cola",
        next,
      );
      releaseAndContinue();
    }
  }, 1200);
}

// ----------------------------
// Emit movimiento propio (sin retries)
// ----------------------------
function emitOnlineMove(from, to, promotion = null) {
  if (!isOnlineGame || !currentRoomId) return;

  const s = ensureSocket();
  if (!s) return;

  if (!s.connected) {
    console.warn("[ON] socket no conectado, pidiendo sync (no emit)");
    requestSyncThrottled();
    return;
  }

  const id =
    crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const payload = { roomId: currentRoomId, move: { from, to, id, promotion } };

  s.emit("playerMove", payload, (res) => {
    if (!res?.ok) {
      console.warn("[ON] ACK fallo, pedir sync", res);
      requestSyncThrottled();
      return;
    }
    if (res.seq) lastAppliedSeq = Math.max(lastAppliedSeq, res.seq);
  });
}

// ============================================================
// 3) UI SETUP: dropdowns / overlays
// ============================================================

// Dificultad (nivel 1–10)
let difficultyLevel = 1;

// Tiempo seleccionado (segundos). null => Infinity
let selectedTime = null;

// Elementos UI principales (se usan luego)
const chessContainer = document.querySelector(".chess-container");
const chessBoard = $("chessBoard");
const mainSection = $("mainSection");

// Timers UI
const player1TimerEl = document.querySelector("#player1 .player-timer");
const player2TimerEl = document.querySelector("#player2 .player-timer");
const player1ScoreEl = document.querySelector("#player1 .player-score");
const player2ScoreEl = document.querySelector("#player2 .player-score");

// Botones
const btnOnline = $("btnOnline");
const btnLocal = $("btnLocal");
const playButton = $("playButton");

const onlineChoice = $("onlineChoice");
const onlineLobby = $("onlineLobby");
const gameContainer = $("gameContainer");

const btnCreateRoom = $("btnCreateRoom");
const btnJoinRoom = $("btnJoinRoom");
const joinCodeInput = $("joinCodeInput");
const createdRoomBox = $("createdRoom");
const roomCodeText = $("roomCodeText");
const copyRoomCode = $("copyRoomCode");
const cancelOnlineChoice = $("cancelOnlineChoice");

// Loading overlays
const loadingOverlay = $("loadingOverlay");
const pregameOverlay = $("pregameLoadingOverlay");
const pregameProgress = $("pregameProgress");
const pregamePercent = $("pregamePercent");

// Chat UI (se completa en bloque 13, aquí solo referencias)
const chatPanel = $("chatPanel");
const chatModal = $("chatModal");
const chatMessages = $("chatMessages");
const chatForm = $("chatForm");
const chatInput = $("chatInput");
const btnChat = $("btnChat");
const chatClose = $("chatClose");

const chatBadge = $("chatBadge");

// Dropdowns UI
let activeDropdown = null;

function closeActiveDropdown() {
  if (!activeDropdown) return;

  const { opts, placeholder } = activeDropdown;

  opts.classList.remove("open");
  document.body.classList.remove("dropdown-open");

  if (placeholder && placeholder.parentNode) {
    placeholder.parentNode.replaceChild(opts, placeholder);
  }

  activeDropdown = null;
}

function setupDropdown(buttonId, optionsId, onSelect) {
  const btn = $(buttonId);
  const opts = $(optionsId);
  if (!btn || !opts) return;

  btn.addEventListener("pointerup", (e) => {
    e.preventDefault();
    e.stopPropagation();

    // si este mismo está abierto, lo cerramos
    if (activeDropdown && activeDropdown.opts === opts) {
      closeActiveDropdown();
      return;
    }

    // cerramos cualquier otro
    closeActiveDropdown();

    // dejamos una marca en su lugar original
    const placeholder = document.createComment(`dropdown-placeholder-${optionsId}`);
    opts.parentNode.insertBefore(placeholder, opts);

    // movemos el UL al body para que el fixed sea REALMENTE fullscreen
    document.body.appendChild(opts);

    opts.classList.add("open");
    document.body.classList.add("dropdown-open");

    activeDropdown = { btn, opts, placeholder };
  });

  opts.querySelectorAll("li").forEach((li) => {
    li.addEventListener("pointerup", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const label = li.dataset.label || li.textContent.trim();
      btn.textContent = label;

      onSelect(li.dataset);
      closeActiveDropdown();
    });
  });
}

// cerrar al pulsar fuera
document.addEventListener("pointerup", (e) => {
  if (!activeDropdown) return;

  const { btn, opts } = activeDropdown;
  if (!btn.contains(e.target) && !opts.contains(e.target)) {
    closeActiveDropdown();
  }
});

// cerrar con Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeActiveDropdown();
  }
});

// cerrar al redimensionar
window.addEventListener("resize", () => {
  closeActiveDropdown();
});

function initSetupDropdowns() {
  setupDropdown("difficultyButton", "difficultyOptions", ({ level }) => {
    difficultyLevel = parseInt(level, 10) || 1;
    updateRobotDifficultyBadge(difficultyLevel);
  });

  setupDropdown("colorButton", "colorOptions", ({ color }) => {
    humanColor = color === "b" ? "b" : "w";
    // El tablero se inicializa al empezar partida, no aquí.
  });

  setupDropdown("timeConfigButton", "timeOptions", ({ time }) => {
    const mins = parseInt(time, 10);
    selectedTime = Number.isFinite(mins) ? mins * 60 : null;
    playButton?.classList.remove("hidden");
  });
}

// Setup inicial “safe”: solo UI (no lógica de partida aún)
function initUISetup() {
  initSetupDropdowns();

  // Chat oculto por defecto (solo en online)
  chatPanel?.classList.add("hidden");
  if (chatMessages) chatMessages.innerHTML = "";

  // Modal chat (si existe)
  chatClose?.addEventListener("pointerup", () =>
    chatModal?.classList.add("hidden"),
  );
  chatModal?.addEventListener("pointerup", (e) => {
    if (e.target === chatModal) chatModal.classList.add("hidden");
  });

  // Botón ONLINE
  btnOnline?.addEventListener("pointerup", () => {
    const s = ensureSocket();
    if (!s) {
      alert(
        "El modo online no funciona en GitHub Pages. Usa modo robot/local o despliega el servidor.",
      );
      return;
    }
    if (mainSection) mainSection.style.display = "none";
    onlineChoice?.classList.remove("hidden");
    isOnlineGame = true;
  });

  // Botón LOCAL (robot)
  btnLocal?.addEventListener("pointerup", () => {
    teardownSocket();
    // Reset modo
    isOnlineGame = false;
    currentRoomId = null;
    refreshConnVisibility();

    // Ocultar home
    if (mainSection) mainSection.style.display = "none";

    // Mostrar setup de juego
    gameContainer?.classList.remove("hidden");
    const gameSetup = $("gameSetup");
    gameSetup?.classList.remove("hidden");

    document.querySelector(".move-history-wrapper")?.classList.add("hidden");
    document.querySelector(".chess-container")?.classList.add("hidden");

    // Defaults
    humanColor = "w";
    selectedTime = null;

    playButton?.classList.remove("hidden");

    // Cierra dropdowns
    $$(".options").forEach((opt) => opt.classList.remove("open"));
    // ✅ En offline: oculta indicador de conexión si existe
    $("connStatus")?.classList.add("hidden");
  });

  // Cancel online choice
  cancelOnlineChoice?.addEventListener("pointerup", () => {
    isOnlineGame = false;
    onlineChoice?.classList.add("hidden");
    if (mainSection) mainSection.style.display = "block";
  });

  // Crear sala
  btnCreateRoom?.addEventListener("pointerup", () => {
    btnCreateRoom.disabled = true;
    const s = ensureSocket();
    if (!s) {
      btnCreateRoom.disabled = false;
      return;
    }

    createdRoomBox?.classList.add("hidden");
    if (roomCodeText) roomCodeText.textContent = "";
    s.emit("newGame");
  });

  // Unirse
  btnJoinRoom?.addEventListener("pointerup", () => {
    const code = (joinCodeInput?.value || "").trim();
    if (!code) return;
    btnJoinRoom.disabled = true;
    ensureSocket()?.emit("joinGame", code);
    // Se re-habilita en disconnect/error si falla
  });

  // Copiar código
  copyRoomCode?.addEventListener("pointerup", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const code = String(roomCodeText?.textContent || "").trim();
    if (!code) return;

    try {
      await copyTextToClipboard(code);
      const old = copyRoomCode.textContent;
      copyRoomCode.textContent = "✅ Copiado";
      setTimeout(() => (copyRoomCode.textContent = old), 900);
    } catch (err) {
      console.warn("[UI] No se pudo copiar:", err);
      alert("No se pudo copiar automáticamente. Copia manualmente el código.");
    }
  });
}

// ============================================================
// 4) AUDIO: música + SFX
// ============================================================

const soundVolumes = {
  move: 0.5,
  capture: 0.4,
  check: 0.4,
  checkmate: 0.5,
  promotion: 0.5,
  select: 0.6,
  error: 0.6,
};

function setSoundVolume(name, value) {
  if (soundVolumes[name] == null) return;
  soundVolumes[name] = Math.max(0, Math.min(1, value));
}

const audioPools = new Map();
function playSound(audioObj, type) {
  if (!audioObj) return;
  const key = audioObj.src + "|" + type;
  let pool = audioPools.get(key);
  if (!pool) {
    pool = {
      idx: 0,
      items: Array.from({ length: 4 }, () => audioObj.cloneNode()),
    };
    audioPools.set(key, pool);
  }
  const snd = pool.items[pool.idx++ % pool.items.length];
  snd.currentTime = 0;
  snd.volume = soundVolumes[type] ?? 0.9;
  snd.play().catch(() => {});
}

// Música (exponemos para que online startGame pueda usarla sin duplicar)
const menuMusic = new Audio("assets/sounds/music-1.m");
menuMusic.loop = true;
menuMusic.volume = 0.1;

const gameMusic = new Audio();
gameMusic.loop = true;
gameMusic.volume = 0.1;

const playlist = ["assets/sounds/music-4.mp3"];
let currentTrack = 0;

function loadTrack(idx) {
  currentTrack = (idx + playlist.length) % playlist.length;
  gameMusic.src = playlist[currentTrack];
}
function playGameMusic() {
  loadTrack(currentTrack);
  gameMusic.currentTime = 0;
  gameMusic.play().catch(() => {});
}

// Exponer (para el bloque online startGame, por compat)
window.menuMusic = menuMusic;
window.playGameMusic = playGameMusic;

// SFX
const buttonSound = new Audio("assets/sounds/sound-select(2).mp3");
const selectSound = new Audio("assets/sounds/sound-select(1).mp3");
const checkSound = new Audio("assets/sounds/sound-check.wav");
const checkmateSound = new Audio("assets/sounds/sound-checkmate.wav");
const moveSound = new Audio("assets/sounds/sound-move(8).mp3");
const captureSound = new Audio("assets/sounds/sound-capture(4).mp3");
const errorSound = new Audio("assets/sounds/sound-error(3).mp3");
const promotionSound = new Audio("assets/sounds/sound-recharged(5).mp3");

// Audio UI
const btnPrevTrack = $("prevTrack");
const btnNextTrack = $("nextTrack");
const btnToggleMute = $("toggleMute");

btnPrevTrack?.addEventListener("click", () => {
  loadTrack(currentTrack - 1);
  playGameMusic();
});
btnNextTrack?.addEventListener("click", () => {
  loadTrack(currentTrack + 1);
  playGameMusic();
});
btnToggleMute?.addEventListener("click", () => {
  gameMusic.muted = !gameMusic.muted;
  btnToggleMute.textContent = gameMusic.muted ? "🔇" : "🔊";
});

// Sonido botones (evita prev/next)
function bindButtonSfx() {
  $$("button").forEach((btn) => {
    if (btn.id !== "btnPrev" && btn.id !== "btnNext") {
      addEventMulti(btn, ["pointerup"], () => playSound(buttonSound, "select"));
    }
  });
}

// ============================================================
// 5) UI GENERAL: menú header + overlays de carga
// ============================================================

function initGeneralUI() {
  // Menu header
  $("menuButton")?.addEventListener("pointerup", () => {
    $("dropdownMenu")?.classList.toggle("show");
  });
  document.querySelector(".menu-close")?.addEventListener("pointerup", () => {
    $("dropdownMenu")?.classList.remove("show");
  });

  // Arranca música menú (silencioso si el navegador bloquea autoplay)
  menuMusic.play().catch(() => {});

    // Modal "Tablero y piezas"
  const openBoardPieces = $("openBoardPieces");
  const boardPiecesModal = $("boardPiecesModal");
  const closeBoardPiecesModal = $("closeBoardPiecesModal");

  openBoardPieces?.addEventListener("pointerup", (e) => {
    e.preventDefault();
    boardPiecesModal?.classList.remove("hidden");
    $("dropdownMenu")?.classList.remove("show");
    updateVisualThemeButtonsUI();
  });

  closeBoardPiecesModal?.addEventListener("pointerup", () => {
    boardPiecesModal?.classList.add("hidden");
  });

  boardPiecesModal?.addEventListener("pointerup", (e) => {
    if (e.target === boardPiecesModal) {
      boardPiecesModal.classList.add("hidden");
    }
  });

  document.querySelectorAll(".visual-theme-btn").forEach((btn) => {
    btn.addEventListener("pointerup", () => {
      const themeName = btn.dataset.visualtheme;
      if (!themeName) return;

      applyVisualTheme(themeName);
      updateVisualThemeButtonsUI();
    });
  });
}

// ============================================================
// 6) TABLERO: generación, coordenadas, render
// ============================================================

// IMAGENES DE PIEZAS
// ===== Sistema de sets de piezas =====

const PIECESET_KEY = "NEONCHESS_PIECES";

// sets disponibles
const PIECESETS = {
  default: "assets/images/pieces/default",
  "neon-classic": "assets/images/pieces/neon-classic",
};

const VISUAL_THEME_KEY = "NEONCHESS_VISUAL_THEME";

const VISUAL_THEMES = {
  default: "default",
  "neon-classic": "neon-classic"
};

let currentVisualTheme =
  localStorage.getItem(VISUAL_THEME_KEY) || "default";

function applyVisualTheme(themeName) {
  if (!VISUAL_THEMES[themeName]) return;

  currentVisualTheme = themeName;
  localStorage.setItem(VISUAL_THEME_KEY, themeName);

  document.body.dataset.theme = themeName;

  // sincroniza automáticamente las piezas con el tema visual
  if (PIECESETS[themeName]) {
    currentPieceSet = themeName;
    localStorage.setItem(PIECESET_KEY, themeName);
    pieceImages = getPieceImages();
  }

  updateColorOptionImages();
  renderBoard();
}

function initVisualTheme() {
  const savedTheme = localStorage.getItem(VISUAL_THEME_KEY) || "default";
  applyVisualTheme(savedTheme);
}
// set activo
let currentPieceSet = localStorage.getItem(PIECESET_KEY) || "default";

// genera dinámicamente las rutas de piezas
function getPieceImages() {
  const base = PIECESETS[currentPieceSet];

  return {
    wk: `${base}/wk.png`,
    wq: `${base}/wq.png`,
    wr: `${base}/wr.png`,
    wb: `${base}/wb.png`,
    wn: `${base}/wn.png`,
    wp: `${base}/wp.png`,
    bk: `${base}/bk.png`,
    bq: `${base}/bq.png`,
    br: `${base}/br.png`,
    bb: `${base}/bb.png`,
    bn: `${base}/bn.png`,
    bp: `${base}/bp.png`,
  };
}

// objeto usado por el tablero
let pieceImages = getPieceImages();

function updateColorOptionImages() {
  const whiteImg = $("colorOptionWhiteImg");
  const blackImg = $("colorOptionBlackImg");

  if (!whiteImg || !blackImg) return;

  // Usa las imágenes reales del set activo
  whiteImg.src = pieceImages.wp;
  blackImg.src = pieceImages.bp;

  // Fuerza repintado limpio por si venían de una ruta rota anterior
  whiteImg.style.display = "block";
  blackImg.style.display = "block";
}

function setPieceSet(setName) {
  if (!PIECESETS[setName]) return;

  currentPieceSet = setName;
  localStorage.setItem(PIECESET_KEY, setName);

  pieceImages = getPieceImages();

  renderBoard();
  updatePieceSetButtonsUI();
}

function updateVisualThemeButtonsUI() {
  document.querySelectorAll(".visual-theme-btn").forEach((btn) => {
    const isActive = btn.dataset.visualtheme === currentVisualTheme;
    btn.classList.toggle("active", isActive);
  });
}

// Helpers UI (marcadores / highlights)
function removeMoveIndicators() {
  $$(".move-indicator").forEach((m) => m.remove());
}
function removeLastMoveHighlights() {
  $$(".cell").forEach((cell) => cell.classList.remove("highlight", "selected"));
  lastMoveCells = [];
  selectedCell = null;
}
function createMarker() {
  const m = document.createElement("div");
  m.classList.add("move-indicator");
  return m;
}
function insertMarker(cell) {
  const marker = createMarker();
  const img = cell.querySelector("img");
  if (img) cell.insertBefore(marker, img);
  else cell.appendChild(marker);
}

// Flip + generar + coordenadas + set initial pieces
function setupInitialBoard() {
  const boardEl = $("chessBoard");
  if (!boardEl) return;

  // Flip según color humano
  boardEl.classList.toggle("flipped", humanColor === "b");

  generateEmptyBoard();
  renderCoordinates();

  // Setup piezas
  board[0] = ["br", "bn", "bb", "bq", "bk", "bb", "bn", "br"];
  board[1] = Array(8).fill("bp");
  board[6] = Array(8).fill("wp");
  board[7] = ["wr", "wn", "wb", "wq", "wk", "wb", "wn", "wr"];

  // Reset flags
  enPassantTarget = null;
  positionHistory = [];
  currentHistoryIndex = 0;
  isReviewMode = false;

  renderBoard();
  updatePositionHistory();
}

function generateEmptyBoard() {
  const boardEl = $("chessBoard");
  if (!boardEl) return;

  boardEl.innerHTML = "";
  board = [];

  for (let row = 0; row < 8; row++) {
    const rowArr = [];
    for (let col = 0; col < 8; col++) {
      const cell = document.createElement("div");
      const isLight = (row + col) % 2 === 0;
      cell.className = `cell ${isLight ? "light" : "dark"}`;
      cell.dataset.row = row;
      cell.dataset.col = col;

      // onCellClick se define en bloque 9 (function hoisting ok)
      cell.addEventListener("pointerup", onCellClick);

      boardEl.appendChild(cell);
      rowArr.push(null);
    }
    board.push(rowArr);
  }
}

// Obtiene la celda DOM para una posición lógica
function getCell(row, col) {
  const boardEl = $("chessBoard");
  if (!boardEl) return null;

  const isFlipped = boardEl.classList.contains("flipped");
  const physRow = isFlipped ? 7 - row : row;
  const physCol = isFlipped ? 7 - col : col;
  const idx = physRow * 8 + physCol;

  return boardEl.children[idx] || null;
}

function renderBoard() {
  const boardEl = $("chessBoard");
  if (!boardEl) return;

  const isFlipped = boardEl.classList.contains("flipped");

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const physRow = isFlipped ? 7 - row : row;
      const physCol = isFlipped ? 7 - col : col;
      const idx = physRow * 8 + physCol;
      const cell = boardEl.children[idx];
      if (!cell) continue;

      const code = board[row][col];

      // Sanitize: evita duplicados “fantasma”
      const imgs = cell.querySelectorAll("img.piece");
      if (imgs.length > 1) {
        for (let k = 1; k < imgs.length; k++) imgs[k].remove();
      }

      let img = cell.querySelector("img.piece");

      if (code) {
        if (!img) {
          img = document.createElement("img");
          img.className = "piece";
          img.draggable = false;

          // Drag & drop (onPointerDown se define en bloque 9)
          img.addEventListener("pointerdown", onPointerDown);

          cell.appendChild(img);
        }

        // Blindaje anti “invisible”
        img.style.visibility = "visible";
        img.style.opacity = "1";

        if (img.src !== new URL(pieceImages[code], window.location.href).href) {
          img.src = pieceImages[code];
        }
        img.alt = code;
        img.dataset.code = code;
      } else {
        // celda vacía => nada de piezas en DOM
        imgs.forEach((p) => p.remove());
      }
    }
  }
}

// Coordenadas (a1..h8) sobre el tablero
function renderCoordinates() {
  const boardEl = $("chessBoard");
  if (!boardEl) return;

  const isFlipped = boardEl.classList.contains("flipped");
  boardEl.querySelectorAll(".coord-label").forEach((n) => n.remove());

  const files = "abcdefgh";

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = boardEl.children[r * 8 + c];
      if (!cell) continue;

      cell.style.position = "relative";

      const rank = isFlipped ? 1 + r : 8 - r;
      const file = isFlipped ? files[7 - c] : files[c];

      if (c === 0) {
        const lab = document.createElement("div");
        lab.className = "coord-label row";
        lab.textContent = String(rank);
        lab.style.cssText = `
          position:absolute; top:3px; left:3px;
          font-family:FrancoisOne, sans-serif;
          font-size:12px; line-height:12px;
          color:var(--coord-color);
          text-shadow:0 0 10px var(--coord-color);
          z-index:1;
          pointer-events:none;
          user-select:none;
        `;
        cell.appendChild(lab);
      }

      if (r === 7) {
        const lab = document.createElement("div");
        lab.className = "coord-label col";
        lab.textContent = file;
        lab.style.cssText = `
          position:absolute; bottom:3px; right:3px;
          font-family:FrancoisOne, sans-serif;
          font-size:12px; line-height:12px;
          color:var(--coord-color);
          text-shadow:0 0 10px var(--coord-color);
          z-index:1;
          pointer-events:none;
          user-select:none;
        `;
        cell.appendChild(lab);
      }
    }
  }
}

// ============================================================
// 7) REGLAS: validación movimientos, ataques, jaque/mate/tablas
// ============================================================

function isPathClear(from, to) {
  const dRow = to.row - from.row;
  const dCol = to.col - from.col;
  const stepRow = dRow === 0 ? 0 : dRow / Math.abs(dRow);
  const stepCol = dCol === 0 ? 0 : dCol / Math.abs(dCol);

  let r = from.row + stepRow;
  let c = from.col + stepCol;

  while (r !== to.row || c !== to.col) {
    if (board[r][c]) return false;
    r += stepRow;
    c += stepCol;
  }
  return true;
}

function canAttack(fromPos, toPos) {
  const p = board[fromPos.row][fromPos.col];
  if (!p) return false;

  const type = p[1];
  const dRow = toPos.row - fromPos.row;
  const dCol = toPos.col - fromPos.col;

  switch (type) {
    case "p":
      return p[0] === "w"
        ? dRow === -1 && Math.abs(dCol) === 1
        : dRow === 1 && Math.abs(dCol) === 1;

    case "r":
      return (dRow === 0 || dCol === 0) && isPathClear(fromPos, toPos);

    case "n":
      return (
        (Math.abs(dRow) === 2 && Math.abs(dCol) === 1) ||
        (Math.abs(dRow) === 1 && Math.abs(dCol) === 2)
      );

    case "b":
      return Math.abs(dRow) === Math.abs(dCol) && isPathClear(fromPos, toPos);

    case "q":
      return (
        (dRow === 0 || dCol === 0 || Math.abs(dRow) === Math.abs(dCol)) &&
        isPathClear(fromPos, toPos)
      );

    case "k":
      return Math.abs(dRow) <= 1 && Math.abs(dCol) <= 1;

    default:
      return false;
  }
}

function isSquareAttacked(pos, color) {
  const opp = color === "w" ? "b" : "w";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p[0] === opp && canAttack({ row: r, col: c }, pos)) return true;
    }
  }
  return false;
}

function findKingPosition(color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === color + "k") return { row: r, col: c };
    }
  }
  return null;
}

function isKingInCheck(color) {
  const kingPos = findKingPosition(color);
  return kingPos ? isSquareAttacked(kingPos, color) : false;
}

function moveLeavesKingInCheck(from, to, color) {
  const origFrom = board[from.row][from.col];
  const origTo = board[to.row][to.col];

  board[to.row][to.col] = origFrom;
  board[from.row][from.col] = null;

  const inCheck = isKingInCheck(color);

  board[to.row][to.col] = origTo;
  board[from.row][from.col] = origFrom;

  return inCheck;
}

function isValidMove(from, to) {
  const p = board[from.row][from.col];
  if (!p) return false;

  const color = p[0];
  const type = p[1];
  const target = board[to.row][to.col];

  if (target && target[0] === color) return false;

  const dRow = to.row - from.row;
  const dCol = to.col - from.col;

  switch (type) {
    case "p": {
      if (color === "w") {
        if (dRow === -1 && dCol === 0 && !target)
          return !moveLeavesKingInCheck(from, to, color);

        if (
          from.row === 6 &&
          dRow === -2 &&
          dCol === 0 &&
          !target &&
          !board[from.row - 1][from.col]
        )
          return !moveLeavesKingInCheck(from, to, color);

        if (dRow === -1 && Math.abs(dCol) === 1 && target && target[0] === "b")
          return !moveLeavesKingInCheck(from, to, color);

        // en-passant
        if (
          dRow === -1 &&
          Math.abs(dCol) === 1 &&
          !target &&
          enPassantTarget &&
          enPassantTarget.row === to.row &&
          enPassantTarget.col === to.col
        )
          return !moveLeavesKingInCheck(from, to, color);
      } else {
        if (dRow === 1 && dCol === 0 && !target)
          return !moveLeavesKingInCheck(from, to, color);

        if (
          from.row === 1 &&
          dRow === 2 &&
          dCol === 0 &&
          !target &&
          !board[from.row + 1][from.col]
        )
          return !moveLeavesKingInCheck(from, to, color);

        if (dRow === 1 && Math.abs(dCol) === 1 && target && target[0] === "w")
          return !moveLeavesKingInCheck(from, to, color);

        // en-passant
        if (
          dRow === 1 &&
          Math.abs(dCol) === 1 &&
          !target &&
          enPassantTarget &&
          enPassantTarget.row === to.row &&
          enPassantTarget.col === to.col
        )
          return !moveLeavesKingInCheck(from, to, color);
      }
      return false;
    }

    case "r":
      if (dRow !== 0 && dCol !== 0) return false;
      return isPathClear(from, to) && !moveLeavesKingInCheck(from, to, color);

    case "n":
      if (
        (Math.abs(dRow) === 2 && Math.abs(dCol) === 1) ||
        (Math.abs(dRow) === 1 && Math.abs(dCol) === 2)
      )
        return !moveLeavesKingInCheck(from, to, color);
      return false;

    case "b":
      if (Math.abs(dRow) !== Math.abs(dCol)) return false;
      return isPathClear(from, to) && !moveLeavesKingInCheck(from, to, color);

    case "q":
      if (dRow === 0 || dCol === 0 || Math.abs(dRow) === Math.abs(dCol)) {
        return isPathClear(from, to) && !moveLeavesKingInCheck(from, to, color);
      }
      return false;

    case "k": {
      // Enroque: desde col 4, salto 2, misma fila
      if (from.col === 4 && Math.abs(dCol) === 2 && dRow === 0) {
        if (kingMoved[color]) return false;
        const row = from.row;

        if (dCol > 0) {
          // corto
          if (rookMoved[color].right) return false;
          if (board[row][from.col + 1] || board[row][from.col + 2])
            return false;
          if (
            isSquareAttacked({ row, col: from.col }, color) ||
            isSquareAttacked({ row, col: from.col + 1 }, color) ||
            isSquareAttacked({ row, col: from.col + 2 }, color)
          )
            return false;
          return true;
        } else {
          // largo
          if (rookMoved[color].left) return false;
          if (
            board[row][from.col - 1] ||
            board[row][from.col - 2] ||
            board[row][from.col - 3]
          )
            return false;
          if (
            isSquareAttacked({ row, col: from.col }, color) ||
            isSquareAttacked({ row, col: from.col - 1 }, color) ||
            isSquareAttacked({ row, col: from.col - 2 }, color)
          )
            return false;
          return true;
        }
      }

      if (Math.abs(dRow) <= 1 && Math.abs(dCol) <= 1)
        return !moveLeavesKingInCheck(from, to, color);

      return false;
    }

    default:
      return false;
  }
}

function isCheckmate(color) {
  if (!isKingInCheck(color)) return false;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] && board[r][c][0] === color) {
        for (let rr = 0; rr < 8; rr++) {
          for (let cc = 0; cc < 8; cc++) {
            if (isValidMove({ row: r, col: c }, { row: rr, col: cc }))
              return false;
          }
        }
      }
    }
  }
  return true;
}

function isStalemate(color) {
  if (isKingInCheck(color)) return false;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] && board[r][c][0] === color) {
        for (let rr = 0; rr < 8; rr++) {
          for (let cc = 0; cc < 8; cc++) {
            if (isValidMove({ row: r, col: c }, { row: rr, col: cc }))
              return false;
          }
        }
      }
    }
  }
  return true;
}

function simulateMove(from, to, fnCheck) {
  const origFrom = board[from.row][from.col];
  const origTo = board[to.row][to.col];

  board[to.row][to.col] = origFrom;
  board[from.row][from.col] = null;

  let result = false;
  try {
    result = !!fnCheck();
  } finally {
    board[from.row][from.col] = origFrom;
    board[to.row][to.col] = origTo;
  }
  return result;
}

function isPseudoLegalByType(from, to, piece) {
  if (!piece) return false;

  const type = piece[1];
  const dRow = to.row - from.row;
  const dCol = to.col - from.col;

  // No mover a misma casilla
  if (dRow === 0 && dCol === 0) return false;

  switch (type) {
    case "p": {
      // Solo geometría básica (sin validar colisiones ni capturas)
      const dir = piece[0] === "w" ? -1 : 1;
      if (dCol === 0 && (dRow === dir || dRow === 2 * dir)) return true;
      if (Math.abs(dCol) === 1 && dRow === dir) return true;
      return false;
    }
    case "n":
      return (
        (Math.abs(dRow) === 2 && Math.abs(dCol) === 1) ||
        (Math.abs(dRow) === 1 && Math.abs(dCol) === 2)
      );
    case "b":
      return Math.abs(dRow) === Math.abs(dCol);
    case "r":
      return dRow === 0 || dCol === 0;
    case "q":
      return dRow === 0 || dCol === 0 || Math.abs(dRow) === Math.abs(dCol);
    case "k": {
      const isSingleStep = Math.abs(dRow) <= 1 && Math.abs(dCol) <= 1;
      const isCastlingGeom = dRow === 0 && Math.abs(dCol) === 2;
      return isSingleStep || isCastlingGeom;
    }
    default:
      return false;
  }
}

// ============================================================
// 8) ANIMACIONES: mover pieza + VFX + amenazas
// ============================================================

// VFX online (puedes poner false si quieres 0 explosiones online)
const ONLINE_VFX = true;

function animatePieceMove(pieceElem, fromCell, toCell, callback) {
  if (!pieceElem || !fromCell || !toCell) {
    callback && callback();
    return;
  }

  const pieceRect = pieceElem.getBoundingClientRect();
  const toRect = toCell.getBoundingClientRect();

  const w = pieceRect.width;
  const h = pieceRect.height;

  const toLeft = toRect.left + (toRect.width - w) / 2;
  const toTop = toRect.top + (toRect.height - h) / 2;

  const dx = toLeft - pieceRect.left;
  const dy = toTop - pieceRect.top;

  const clone = pieceElem.cloneNode(true);
  Object.assign(clone.style, {
    position: "fixed",
    left: `${pieceRect.left}px`,
    top: `${pieceRect.top}px`,
    width: `${w}px`,
    height: `${h}px`,
    margin: 0,
    pointerEvents: "none",
    zIndex: 9999,
    willChange: "transform",
    transform: "translate3d(0,0,0)",
    backfaceVisibility: "hidden",
  });
  document.body.appendChild(clone);

  // IMPORTANTE: quitamos el original del DOM para evitar parpadeo/duplicados
  pieceElem.remove();

  requestAnimationFrame(() => {
    const anim = clone.animate(
      [
        { transform: "translate3d(0,0,0)" },
        { transform: `translate3d(${dx}px, ${dy}px, 0)` },
      ],
      {
        duration: isOnlineGame ? 100 : 120,
        easing: "ease-in-out",
        fill: "forwards",
      },
    );

    const finish = () => {
      clone.remove();
      callback && callback();
    };
    anim.onfinish = finish;
    anim.oncancel = finish;
  });
}

function createCapturedPieceExplosion(capturedCode, to) {
  const src = pieceImages?.[capturedCode];
  if (!src) return;
  if (isOnlineGame && !ONLINE_VFX) return;

  const cell = getCell(to.row, to.col);
  if (!cell) return;

  const rect = cell.getBoundingClientRect();
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;
  const size = rect.width;

  const count = isOnlineGame ? 8 : 15;
  const duration = isOnlineGame ? 260 : 400;
  const dist = rect.width * (isOnlineGame ? 1.0 : 1.6);

  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;

    const img = document.createElement("img");
    img.src = src;

    Object.assign(img.style, {
      position: "fixed",
      left: `${originX}px`,
      top: `${originY}px`,
      width: `${size}px`,
      height: `${size}px`,
      margin: "0",
      pointerEvents: "none",
      transform: "translate(-50%, -50%) translateZ(0) scale(1)",
      opacity: "1",
      zIndex: "1000",
      willChange: "transform, opacity",
    });

    document.body.appendChild(img);

    img.animate(
      [
        {
          transform:
            "translate(-50%, -50%) translateZ(0) translate(0,0) scale(1)",
          opacity: 1,
        },
        {
          transform: `translate(-50%, -50%) translateZ(0) translate(${dx}px, ${dy}px) scale(${isOnlineGame ? 1.25 : 1.5})`,
          opacity: 0,
        },
      ],
      { duration, easing: "ease-out", fill: "forwards" },
    ).onfinish = () => img.remove();
  }
}

// MATRIX RAIN (robot thinking)

let matrixBuilt = false;

function buildMatrixRain() {
  const overlay = document.querySelector("#player1 .matrix-overlay-player1");
  if (!overlay) return false;

  const rect = overlay.getBoundingClientRect();
  if (rect.width < 50 || rect.height < 30) return false;

  overlay.innerHTML = "";

  // Debe cuadrar con CSS (line-height: 14px)
  const lineH = 14;

  // Columna “ideal” en px (al ser grid 1fr, esto solo calcula cuántas columnas crear)
  const approxColWidth = 10;

  // Más columnas => menos sensación de huecos
  let cols = Math.ceil(rect.width / approxColWidth);
  cols = Math.max(28, Math.min(70, cols));

  const neededLines = Math.ceil(rect.height / lineH);
  const streamLen = neededLines + 20;

  const makeStreamText = (len) => {
    let s = "";
    for (let i = 0; i < len; i++) s += Math.random() > 0.5 ? "1" : "0";
    return s.split("").join("\n");
  };

  // Asegura grid con número exacto de columnas
  overlay.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  for (let i = 0; i < cols; i++) {
    const col = document.createElement("div");
    col.className = "matrix-col";

    const stream = document.createElement("span");
    stream.className = "matrix-stream";
    stream.textContent = makeStreamText(streamLen);

    // Mucho más lento (antes 2.4–5.6s)
    const goingUp = i % 2 === 0;
    const dur = 7.0 + Math.random() * 6.0; // 7–13s
    const delay = -Math.random() * dur;

    stream.style.animationName = goingUp ? "matrix-up" : "matrix-down";
    stream.style.animationDuration = `${dur}s`;
    stream.style.animationTimingFunction = "linear";
    stream.style.animationIterationCount = "infinite";
    stream.style.animationDelay = `${delay}s`;

    // Variación suave (evita “parches” demasiado oscuros)
    col.style.opacity = String(0.75 + Math.random() * 0.25);

    col.appendChild(stream);
    overlay.appendChild(col);
  }

  matrixBuilt = true;
  return true;
}

function setRobotThinking(on) {
  const p1 = $("player1");
  const overlay = document.querySelector("#player1 .matrix-overlay-player1");
  if (!p1 || !overlay) return;

  if (on) {
    // Construcción robusta: si el primer intento da tamaño 0, reintenta 1-2 frames
    if (!matrixBuilt) {
      const ok = buildMatrixRain();
      if (!ok) {
        requestAnimationFrame(() => {
          const ok2 = buildMatrixRain();
          if (!ok2) requestAnimationFrame(() => buildMatrixRain());
        });
      }
    }
  }

  p1.classList.toggle("thinking", !!on);
  overlay.classList.toggle("visible", !!on);
}

/* Resize: solo reconstruye si ya existe (y con debounce) */
let __matrixResizeT = 0;
window.addEventListener("resize", () => {
  clearTimeout(__matrixResizeT);
  __matrixResizeT = setTimeout(() => {
    const p1 = $("player1");
    const overlay = document.querySelector("#player1 .matrix-overlay-player1");
    if (!p1 || !overlay) return;

    const isOn =
      p1.classList.contains("thinking") &&
      overlay.classList.contains("visible");
    if (!isOn) return;

    matrixBuilt = false;
    buildMatrixRain();
  }, 120);
});

// Jaque / mate overlays (simple)
function showCheckAnimation() {
  const anim = document.createElement("div");
  anim.classList.add("check-animation");
  anim.textContent = "CHECK!";
  const boardRect = $("chessBoard")?.getBoundingClientRect();
  if (!boardRect) return;
  Object.assign(anim.style, {
    position: "absolute",
    left: `${boardRect.left + boardRect.width / 2}px`,
    top: `${boardRect.top + boardRect.height / 2}px`,
    pointerEvents: "none",
    transform: "translate(-50%, -50%)",
    zIndex: 2000,
  });
  document.body.appendChild(anim);
  anim.addEventListener("animationend", () => anim.remove());
}

function showCheckmateAnimation() {
  const anim = document.createElement("div");
  anim.classList.add("checkmate-animation");
  anim.textContent = "CHECKMATE!";
  const boardRect = $("chessBoard")?.getBoundingClientRect();
  if (!boardRect) return;
  Object.assign(anim.style, {
    position: "absolute",
    left: `${boardRect.left + boardRect.width / 2}px`,
    top: `${boardRect.top + boardRect.height / 2}px`,
    pointerEvents: "none",
    transform: "translate(-50%, -50%)",
    zIndex: 2000,
  });
  document.body.appendChild(anim);
  anim.addEventListener("animationend", () => anim.remove());
}

function showKingThreatAnimation(square, extraSquare = null) {
  const attackers = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p[0] !== currentTurn && canAttack({ row: r, col: c }, square)) {
        attackers.push({ row: r, col: c });
      }
    }
  }

  attackers.forEach(({ row, col }) => {
    const cell = getCell(row, col);
    if (cell) cell.classList.add("threat-highlight");
  });

  const kingCell = getCell(square.row, square.col);
  if (kingCell) kingCell.classList.add("threat-highlight");

  const extraCell = extraSquare
    ? getCell(extraSquare.row, extraSquare.col)
    : null;
  if (extraCell) extraCell.classList.add("threat-highlight");

  setTimeout(() => {
    attackers.forEach(({ row, col }) => {
      const cell = getCell(row, col);
      if (cell) cell.classList.remove("threat-highlight");
    });
    if (kingCell) kingCell.classList.remove("threat-highlight");
    if (extraCell) extraCell.classList.remove("threat-highlight");
  }, 800);
}

// Devuelve lista de atacantes (coords) que atacan `square` (del color opuesto a `defenderColor`)
function getAttackersOfSquare(square, defenderColor) {
  const opp = defenderColor === "w" ? "b" : "w";
  const attackers = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p[0] !== opp) continue;
      if (canAttack({ row: r, col: c }, square))
        attackers.push({ row: r, col: c });
    }
  }
  return attackers;
}

// Flash visual con clase .threat-highlight (atacantes + rey + opcionales)
function flashThreatSquares(squares, duration = 950) {
  const uniq = new Map();
  for (const s of squares || []) {
    if (!s) continue;
    const k = `${s.row},${s.col}`;
    uniq.set(k, s);
  }

  const list = Array.from(uniq.values());
  for (const pos of list) {
    const cell = getCell(pos.row, pos.col);
    if (cell) cell.classList.add("threat-highlight");
  }

  setTimeout(() => {
    for (const pos of list) {
      const cell = getCell(pos.row, pos.col);
      if (cell) cell.classList.remove("threat-highlight");
    }
  }, duration);
}

// Simula un movimiento (incluye en-passant y enroque) y ejecuta fn dentro; luego revierte.
function simulateMoveAdvanced(from, to, fn) {
  const piece = board[from.row][from.col];
  const origFrom = piece;
  const origTo = board[to.row][to.col];

  // En-passant (solo para simulación)
  let epCapturedPos = null;
  let epCapturedPiece = null;
  if (
    piece &&
    piece[1] === "p" &&
    Math.abs(to.col - from.col) === 1 &&
    !origTo &&
    enPassantTarget &&
    enPassantTarget.row === to.row &&
    enPassantTarget.col === to.col
  ) {
    epCapturedPos = { row: from.row, col: to.col };
    epCapturedPiece = board[epCapturedPos.row][epCapturedPos.col];
  }

  // Enroque (solo para simulación)
  const isCastling =
    piece && piece[1] === "k" && Math.abs(to.col - from.col) === 2;
  let rookFrom = null,
    rookTo = null,
    rookPiece = null;

  // Aplica move principal
  board[to.row][to.col] = origFrom;
  board[from.row][from.col] = null;

  // Aplica EP captura
  if (epCapturedPos) board[epCapturedPos.row][epCapturedPos.col] = null;

  // Aplica rook en enroque
  if (isCastling) {
    const row = from.row;
    const rookFromCol = to.col === 6 ? 7 : 0;
    const rookToCol = to.col === 6 ? 5 : 3;

    rookFrom = { row, col: rookFromCol };
    rookTo = { row, col: rookToCol };
    rookPiece = board[rookFrom.row][rookFrom.col];

    board[rookTo.row][rookTo.col] = rookPiece;
    board[rookFrom.row][rookFrom.col] = null;
  }

  let out;
  try {
    out = fn();
  } finally {
    // Revierte enroque
    if (isCastling && rookFrom && rookTo) {
      board[rookFrom.row][rookFrom.col] = rookPiece;
      board[rookTo.row][rookTo.col] = null;
    }

    // Revierte EP
    if (epCapturedPos)
      board[epCapturedPos.row][epCapturedPos.col] = epCapturedPiece;

    // Revierte principal
    board[from.row][from.col] = origFrom;
    board[to.row][to.col] = origTo;
  }
  return out;
}

// Rey intenta moverse a casilla atacada: ilumina destino rey + atacante(s)
function showIllegalKingDestinationThreat(from, to, color) {
  simulateMoveAdvanced(from, to, () => {
    const kingPos = findKingPosition(color) || { ...to };
    const attackers = getAttackersOfSquare(kingPos, color);
    flashThreatSquares([kingPos, ...attackers], 1000);
  });
}

// Pieza intenta moverse y deja a su rey en jaque (pieza clavada / destapa línea):
// ilumina REY + atacante(s), NO la casilla destino.
function showExposedKingThreatAfterMove(from, to, color) {
  simulateMoveAdvanced(from, to, () => {
    const kingPos = findKingPosition(color);
    if (!kingPos) return;
    const attackers = getAttackersOfSquare(kingPos, color);
    flashThreatSquares([kingPos, ...attackers], 1000);
  });
}

// ============================================================
// 9) LÓGICA DE MOVIMIENTO: movePiece + noAnim + selección
// ============================================================

function getLogicalPos(cell) {
  let row = parseInt(cell.dataset.row, 10);
  let col = parseInt(cell.dataset.col, 10);
  const isFlipped = $("chessBoard")?.classList.contains("flipped");
  if (isFlipped) {
    row = 7 - row;
    col = 7 - col;
  }
  return { row, col };
}

function showLegalMoves(from) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isValidMove(from, { row: r, col: c })) insertMarker(getCell(r, c));
    }
  }
  const p = board[from.row][from.col];
  if (p && p[1] === "k") {
    const row = from.row;
    if (isValidMove(from, { row, col: from.col + 2 }))
      insertMarker(getCell(row, from.col + 1));
    if (isValidMove(from, { row, col: from.col - 2 }))
      insertMarker(getCell(row, from.col - 1));
  }
}

function blinkCell(cell) {
  if (!cell) return;
  cell.classList.add("blink-error");
  setTimeout(() => cell.classList.remove("blink-error"), 400);
  playSound(errorSound, "error");
}

// --- Turn LEDs (online/local)
function setTurnLED() {
  const p1 = $("turnLedP1");
  const p2 = $("turnLedP2");
  if (!p1 || !p2) return;

  // player2 = tú (abajo), player1 = rival/robot (arriba)
  const turnIsMine = currentTurn === humanColor;
  p2.classList.toggle("on", turnIsMine);
  p1.classList.toggle("on", !turnIsMine);
}

// --- Update UI scores/health
function updateScores() {
  const diffW = scores.w - scores.b;
  const diffB = scores.b - scores.w;

  if (humanColor === "w") {
    player2ScoreEl &&
      (player2ScoreEl.textContent = "Puntos: +" + Math.max(diffW, 0));
    player1ScoreEl &&
      (player1ScoreEl.textContent = "Puntos: +" + Math.max(diffB, 0));
  } else {
    player1ScoreEl &&
      (player1ScoreEl.textContent = "Puntos: +" + Math.max(diffW, 0));
    player2ScoreEl &&
      (player2ScoreEl.textContent = "Puntos: +" + Math.max(diffB, 0));
  }
}

function getHealthColor(ratio) {
  let hue;
  if (ratio >= 0.75) {
    const t = (ratio - 0.75) / 0.25;
    hue = 120 + t * (210 - 120);
  } else if (ratio >= 0.5) {
    const t = (ratio - 0.5) / 0.25;
    hue = 60 + t * (120 - 60);
  } else if (ratio >= 0.25) {
    const t = (ratio - 0.25) / 0.25;
    hue = 30 + t * (60 - 30);
  } else {
    const t = ratio / 0.25;
    hue = 0 + t * 30;
  }
  return `hsl(${hue.toFixed(0)}, 70%, 50%)`;
}

function updateHealthBar() {
  const barWhite = $("health-white");
  const barBlack = $("health-black");
  if (!barWhite || !barBlack) return;

  const ratioW = Math.max(0, Math.min(1, currentHealth.w / maxHealth.w));
  const ratioB = Math.max(0, Math.min(1, currentHealth.b / maxHealth.b));

  if (humanColor === "b") {
    barWhite.style.width = `${ratioB * 100}%`;
    barWhite.style.backgroundColor = getHealthColor(ratioB);
    barBlack.style.width = `${ratioW * 100}%`;
    barBlack.style.backgroundColor = getHealthColor(ratioW);
  } else {
    barWhite.style.width = `${ratioW * 100}%`;
    barWhite.style.backgroundColor = getHealthColor(ratioW);
    barBlack.style.width = `${ratioB * 100}%`;
    barBlack.style.backgroundColor = getHealthColor(ratioB);
  }
}

// ----------------------------
// Movimiento con animación
// ----------------------------
function movePiece(from, to, isHumanMove = false, promoType = null) {
  if (isReviewMode) return;
  if (isAnimating) return;

  startAnimationLock();

  removeMoveIndicators();
  removeLastMoveHighlights();

  const fromCell = getCell(from.row, from.col);
  const toCell = getCell(to.row, to.col);

  // highlights
  fromCell?.classList.add("highlight");
  toCell?.classList.add("highlight");
  lastMoveCells = [
    { row: from.row, col: from.col },
    { row: to.row, col: to.col },
  ];

  const piece = board[from.row][from.col];
  const moveRecord = {
    from: { ...from },
    to: { ...to },
    piece,
    capture: null,
    ts: Date.now(),
  };

  if (!piece) {
    console.warn("[MOVE] from vacía, ignorando", { from, to });
    endAnimationLock();
    return;
  }

  let target = board[to.row][to.col];
  let isCapture = false;
  let captureValue = 0;
  let enPassantCapture = false;

  // En passant
  if (
    piece[1] === "p" &&
    Math.abs(to.col - from.col) === 1 &&
    !target &&
    enPassantTarget &&
    enPassantTarget.row === to.row &&
    enPassantTarget.col === to.col
  ) {
    enPassantCapture = true;
    target = board[from.row][to.col];
  }

  if (target) {
    isCapture = true;
    captureValue = pieceValues[target[1]];
    scores[currentTurn] += captureValue;
    moveRecord.capture = target;
    updateScores();

    const victim = target[0];
    currentHealth[victim] = Math.max(
      kingBaseHealth,
      currentHealth[victim] - captureValue,
    );
    updateHealthBar();
  }

  // Aplica movimiento en board[][]
  board[to.row][to.col] = piece;
  board[from.row][from.col] = null;

  // ✅ PROMOCIÓN (humano: modal | no-humano: auto o por promoType)
  let pendingPromotion = false;
  let promotionColor = null;

  if (piece[1] === "p") {
    const lastRank = piece[0] === "w" ? 0 : 7;
    if (to.row === lastRank) {
      pendingPromotion = true;
      promotionColor = piece[0];
    }
  }

  if (enPassantCapture) board[from.row][to.col] = null;

  // Flags de enroque (movimientos normales)
  if (piece[1] === "k") {
    kingMoved[piece[0]] = true;
  }
  if (piece[1] === "r") {
    if (from.col === 0) rookMoved[piece[0]].left = true;
    if (from.col === 7) rookMoved[piece[0]].right = true;
  }

  // EP target
  if (piece[1] === "p") {
    if (piece[0] === "w" && from.row === 6 && to.row === 4)
      enPassantTarget = { row: 5, col: from.col };
    else if (piece[0] === "b" && from.row === 1 && to.row === 3)
      enPassantTarget = { row: 2, col: from.col };
    else enPassantTarget = null;
  } else {
    enPassantTarget = null;
  }

  // Enroque
  const isCastling = piece[1] === "k" && Math.abs(to.col - from.col) === 2;
  if (isCastling) {
    const row = from.row;
    const rookFromCol = to.col === 6 ? 7 : 0;
    const rookToCol = to.col === 6 ? 5 : 3;

    board[row][rookToCol] = board[row][rookFromCol];
    board[row][rookFromCol] = null;

    kingMoved[currentTurn] = true;
    if (to.col === 6) rookMoved[currentTurn].right = true;
    else rookMoved[currentTurn].left = true;

    playSound(moveSound, "move");
    setTimeout(() => playSound(moveSound, "move"), 100);

    const kFromCell = getCell(from.row, from.col);
    const kToCell = getCell(to.row, to.col);
    const rFromCell = getCell(row, rookFromCol);
    const rToCell = getCell(row, rookToCol);

    const kImg = kFromCell?.querySelector("img.piece");
    const rImg = rFromCell?.querySelector("img.piece");

    let done = 0;
    const onDone = () => {
      done += 1;
      if (done < 2) return;

      requestAnimationFrame(() => {
        renderBoard();

        if (isHumanMove && isOnlineGame && currentRoomId) {
          emitOnlineMove(rcToAlgebraic(from), rcToAlgebraic(to));
        }

        //  HISTORIAL
        pushMoveToHistory(moveRecord);

        finishMove();
        endAnimationLock();
      });
    };

    if (!kImg || !rImg) {
      requestAnimationFrame(() => {
        renderBoard();
        if (isHumanMove && isOnlineGame && currentRoomId)
          emitOnlineMove(rcToAlgebraic(from), rcToAlgebraic(to));
        finishMove();
        endAnimationLock();
      });
      return;
    }

    animatePieceMove(kImg, kFromCell, kToCell, onDone);
    animatePieceMove(rImg, rFromCell, rToCell, onDone);
    return;
  }

  // SFX + VFX captura
  if (isCapture) {
    try {
      createCapturedPieceExplosion(target, to);
    } catch (_) {}
    playSound(captureSound, "capture");
  } else {
    playSound(moveSound, "move");
  }

  // Quita víctima del DOM (si hay)
  if (isCapture && toCell) {
    const victimImg = toCell.querySelector("img.piece");
    if (victimImg) victimImg.remove();
  }

  const movingPieceElem = fromCell?.querySelector("img.piece");

  // Si falta img, no animamos pero consolidamos
  if (!movingPieceElem || !fromCell || !toCell) {
    requestAnimationFrame(() => {
      renderBoard();
      if (isHumanMove && isOnlineGame && currentRoomId)
        emitOnlineMove(rcToAlgebraic(from), rcToAlgebraic(to));
        pushMoveToHistory(moveRecord);
        finishMove();
        endAnimationLock();
    });
    return;
  }

  animatePieceMove(movingPieceElem, fromCell, toCell, () => {
    requestAnimationFrame(async () => {
    renderBoard();

    if (pendingPromotion) {
      let chosen = promoType || "q";
      if (isHumanMove) {
        chosen = await showPromotionModal(promotionColor);
      }
      board[to.row][to.col] = promotionColor + chosen;
      playSound(promotionSound, "promotion");
      renderBoard();
      moveRecord.promotion = chosen;
    }

    if (isHumanMove && isOnlineGame && currentRoomId)
      emitOnlineMove(rcToAlgebraic(from), rcToAlgebraic(to), moveRecord.promotion || null);

      pushMoveToHistory(moveRecord);
      finishMove();
      endAnimationLock();
    });
  });
}

// ----------------------------
// Movimiento sin animación (drag/drop)
// ----------------------------
function movePieceNoAnim(from, to, isHumanMove = false, promoType = null) {
  if (isReviewMode) return;
  if (isAnimating) return;

  startAnimationLock();

  const piece = board[from.row][from.col];
  const moveRecord = {
    from: { ...from },
    to: { ...to },
    piece,
    capture: null,
    ts: Date.now(),
  };

  if (!piece) {
    endAnimationLock();
    return;
  }

  let target = board[to.row][to.col];
  let isCapture = false;
  let captureValue = 0;
  let enPassantCapture = false;

  if (
    piece[1] === "p" &&
    Math.abs(to.col - from.col) === 1 &&
    !target &&
    enPassantTarget &&
    enPassantTarget.row === to.row &&
    enPassantTarget.col === to.col
  ) {
    enPassantCapture = true;
    target = board[from.row][to.col];
  }

  if (target) {
    isCapture = true;
    captureValue = pieceValues[target[1]];
    scores[currentTurn] += captureValue;
    moveRecord.capture = target;
    updateScores();

    const victim = target[0];
    currentHealth[victim] = Math.max(
      kingBaseHealth,
      currentHealth[victim] - captureValue,
    );
    updateHealthBar();
  }

  board[to.row][to.col] = piece;
  board[from.row][from.col] = null;
  if (enPassantCapture) board[from.row][to.col] = null;

  if (isCapture) {
    playSound(captureSound, "capture");
    try {
      createCapturedPieceExplosion(target, to);
    } catch (_) {}
  } else {
    playSound(moveSound, "move");
  }

  requestAnimationFrame(() => {
    renderBoard();
    if (isHumanMove && isOnlineGame && currentRoomId)
      emitOnlineMove(rcToAlgebraic(from), rcToAlgebraic(to));
    pushMoveToHistory(moveRecord);
    finishMove();
    endAnimationLock();
  });
}

// Selección/click
function onCellClick(e) {
  if (processingQueue || onlineMoveQueue.length) return;
  if (isAnimating) return;

  if (isDragging) {
    isDragging = false;
    return;
  }
  e.preventDefault();

  // En online: solo juegas si es tu turno
  if (isOnlineGame && currentTurn !== humanColor) return;

  const cell = this;
  const { row, col } = getLogicalPos(cell);
  const targetPos = { row, col };

  if (!selectedCell) removeLastMoveHighlights();

  if (!selectedCell) {
    if (board[row][col] && board[row][col][0] === currentTurn) {
      selectedCell = { row, col };
      cell.classList.add("selected");
      showLegalMoves(selectedCell);
      playSound(selectSound, "select");
    }
    return;
  }

  // re-selección
  if (board[row][col] && board[row][col][0] === currentTurn) {
    getCell(selectedCell.row, selectedCell.col)?.classList.remove("selected");
    removeMoveIndicators();
    selectedCell = { row, col };
    cell.classList.add("selected");
    showLegalMoves(selectedCell);
    playSound(selectSound, "select");
    return;
  }

  removeMoveIndicators();
  const from = selectedCell;
  const piece = board[from.row][from.col];

  // 0) Si el movimiento ni siquiera respeta la geometría de la pieza => error simple
  if (piece && !isPseudoLegalByType(from, targetPos, piece)) {
    blinkCell(cell);
    getCell(from.row, from.col)?.classList.remove("selected");
    selectedCell = null;
    return;
  }

  // 1) Si es ilegal porque deja al rey en jaque, mostramos animación “amenaza real”
  if (piece && moveLeavesKingInCheck(from, targetPos, currentTurn)) {
    playSound(errorSound, "error");

    if (piece[1] === "k") {
      // Rey entrando en casilla atacada: destino + atacante(s)
      showIllegalKingDestinationThreat(from, targetPos, currentTurn);
    } else {
      // Pieza clavada / destapa línea: rey + atacante(s)
      showExposedKingThreatAfterMove(from, targetPos, currentTurn);
    }

    getCell(from.row, from.col)?.classList.remove("selected");
    selectedCell = null;
    return;
  }

  // 2) Si no es por jaque, usa el error normal
  if (isValidMove(from, targetPos)) {
    getCell(from.row, from.col)?.classList.remove("selected");
    movePiece(from, targetPos, true);
  } else {
    blinkCell(cell);
    getCell(from.row, from.col)?.classList.remove("selected");
  }

  selectedCell = null;
}

function showPromotionModal(color) {
  return new Promise((resolve) => {
    // Overlay
    const overlay = document.createElement("div");
    overlay.id = "promotionModal";
    overlay.style.cssText = `
      position: fixed; inset: 0;
      background: rgba(10, 20, 50, 0.75);
      display: flex; align-items: center; justify-content: center;
      z-index: 999999;
    `;

    // Caja
    const box = document.createElement("div");
    box.style.cssText = `
      background: #0e1838;
      border: 2px solid rgb(79,246,255);
      box-shadow: 0 0 18px rgb(79,246,255);
      border-radius: 3px;
      padding: 16px 18px;
      min-width: 320px;
      text-align: center;
    `;

    const title = document.createElement("div");
    title.textContent = "PROMOCIÓN";
    title.style.cssText = `
      font-family: FrancoisOne, sans-serif;
      color: rgb(17,255,255);
      text-shadow: 0 0 10px rgb(17,255,255);
      margin-bottom: 12px;
      font-size: 18px;
      letter-spacing: 1px;
    `;
    box.appendChild(title);

    const row = document.createElement("div");
    row.style.cssText = `
      display: flex;
      gap: 12px;
      justify-content: center;
      align-items: center;
    `;

    const options = [
      { t: "q", label: "Reina" },
      { t: "r", label: "Torre" },
      { t: "b", label: "Alfil" },
      { t: "n", label: "Caballo" },
    ];

    const makeBtn = (type, label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.cssText = `
        width: 64px; height: 64px;
        border-radius: 10px;
        border: 2px solid rgba(79,246,255,0.85);
        background: rgba(79,246,255,0.08);
        box-shadow: 0 0 10px rgba(79,246,255,0.6), inset 0 0 10px rgba(79,246,255,0.35);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        cursor: pointer;
      `;
      btn.onpointerup = (e) => {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        resolve(type);
      };

      const img = document.createElement("img");
      img.src = pieceImages[color + type];
      img.alt = color + type;
      img.draggable = false;
      img.style.cssText = `width: 44px; height: 44px;`;

      const cap = document.createElement("div");
      cap.textContent = label;
      cap.style.cssText = `
        font-size: 10px;
        margin-top: 4px;
        color: rgba(17,255,255,0.9);
        text-shadow: 0 0 8px rgba(17,255,255,0.7);
        font-family: FrancoisOne, sans-serif;
      `;

      btn.appendChild(img);
      btn.appendChild(cap);
      return btn;
    };

    options.forEach((o) => row.appendChild(makeBtn(o.t, o.label)));
    box.appendChild(row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Bloquear click fuera (no cerrar sin elegir)
    overlay.addEventListener("pointerup", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    function cleanup() {
      overlay.remove();
    }
  });
}

function getWinnerAvatarSrc(winnerColor) {
  // Online: usa los paneles de jugador (arriba/abajo)
  if (isOnlineGame) {
    const topImg = document.querySelector("#player1 img");   // rival (arriba)
    const bottomImg = document.querySelector("#player2 img"); // tú (abajo)

    // winnerColor: "w" o "b"
    // Si tú eres blancas, tú estás abajo. Si tú eres negras, tú estás abajo igualmente.
    // Por UI: abajo = humano local / tu cliente en online
    // Para decidir avatar correcto, mapeamos por color real:
    // player2 = humanColor
    // player1 = color opuesto
    return winnerColor === humanColor ? bottomImg?.src : topImg?.src;
  }

  // Local (robot): player2 = tú, player1 = robot
  const topImg = document.querySelector("#player1 img");    // robot (arriba)
  const bottomImg = document.querySelector("#player2 img"); // tú (abajo)

  return winnerColor === humanColor ? bottomImg?.src : topImg?.src;
}

// ============================================================
// 10) FIN DE MOVIMIENTO + TIMERS + TURNO
// ============================================================

function updateKingStatus() {
  $$(".cell.check, .cell.checkmate").forEach((c) =>
    c.classList.remove("check", "checkmate"),
  );

  ["w", "b"].forEach((color) => {
    const pos = findKingPosition(color);
    if (!pos) return;
    const cell = getCell(pos.row, pos.col);
    if (!cell) return;
    if (isKingInCheck(color))
      cell.classList.add(isCheckmate(color) ? "checkmate" : "check");
  });
}

function isInsufficientMaterial() {
  const pieces = { w: [], b: [] };

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const color = p[0];
      const type = p[1];
      if (type !== "k") pieces[color].push({ type, r, c });
    }
  }

  if (pieces.w.length === 0 && pieces.b.length === 0) return true;

  const minorOnly = (arr) =>
    arr.length === 1 && (arr[0].type === "b" || arr[0].type === "n");
  if (pieces.w.length === 0 && minorOnly(pieces.b)) return true;
  if (pieces.b.length === 0 && minorOnly(pieces.w)) return true;

  const oneBishopOnly = (arr) => arr.length === 1 && arr[0].type === "b";
  if (oneBishopOnly(pieces.w) && oneBishopOnly(pieces.b)) {
    const wColor = (pieces.w[0].r + pieces.w[0].c) % 2;
    const bColor = (pieces.b[0].r + pieces.b[0].c) % 2;
    if (wColor === bColor) return true;
  }

  return false;
}

function repetitionKey() {
  let s = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      s += board[r][c] ? board[r][c] : "0";
      s += ",";
    }
  }
  return `${s}|t:${currentTurn}|c:${getCastlingRights()}|${enPassantTarget ? `ep:${enPassantTarget.row}${enPassantTarget.col}` : "ep:-"}`;
}

function getCastlingRights() {
  let rights = "";
  if (!kingMoved.w) {
    if (!rookMoved.w.right) rights += "K";
    if (!rookMoved.w.left) rights += "Q";
  }
  if (!kingMoved.b) {
    if (!rookMoved.b.right) rights += "k";
    if (!rookMoved.b.left) rights += "q";
  }
  return rights || "-";
}

function getBoardPositionSnapshot() {
  return board.map((row) => row.slice());
}
function getBoardPosition() {
  let pos = "";
  board.forEach((row) =>
    row.forEach((cell) => (pos += (cell ? cell : "0") + ",")),
  );
  pos += "_" + currentTurn;
  return pos;
}
function updatePositionHistory(lastMoveByExplicit) {
  const pos = getBoardPosition();

  if (currentHistoryIndex < positionHistory.length - 1) {
    positionHistory.splice(currentHistoryIndex + 1);
  }

  const lastEntry = positionHistory[positionHistory.length - 1];
  const forcedLastMoveBy =
    positionHistory.length === 0 ? "b" : (lastMoveByExplicit ?? currentTurn);

  if (!lastEntry || lastEntry.pos !== pos) {
    positionHistory.push({
      pos,
      snapshot: getBoardPositionSnapshot(), // ✅ CLAVE
      lastMoveBy: forcedLastMoveBy,
      health: { w: currentHealth.w, b: currentHealth.b },
      scores: { w: scores.w, b: scores.b },
      castling: {
        kingMoved: { ...kingMoved },
        rookMoved: { w: { ...rookMoved.w }, b: { ...rookMoved.b } },
      },
    });

    currentHistoryIndex = positionHistory.length - 1;
  }

  return isInsufficientMaterial();
}

function pushMoveToHistory(mv) {
  if (!mv) return;

  // Si estabas en review y haces un movimiento real: recorta el “futuro”
  if (currentHistoryIndex < positionHistory.length - 1) {
    positionHistory.splice(currentHistoryIndex + 1);
    moveList.splice(currentHistoryIndex);
  }

  moveList.push(mv);
  if (!isReviewMode && !isNavigating) {
    currentHistoryIndex = moveList.length;
  }

  renderMoveHistoryUI();

  // Auto-scroll al final (solo en live)
  scrollMoveHistoryToEnd(true);
}

function renderMoveHistoryUI() {
  const hist = document.querySelector(".move-history");
  if (!hist) return;

  hist.innerHTML = "";

  // En live: mostrar todo.
  // En review/navegación: mostrar solo hasta el snapshot actual.
  const visibleMoves =
    isReviewMode || isNavigating
      ? Math.max(0, currentHistoryIndex)
      : moveList.length;

  for (let i = 0; i < visibleMoves; i++) {
    const m = moveList[i];
    if (!m) continue;

    const entry = document.createElement("div");
    entry.className = "move-entry";

    // 1) Número (primero)
    const num = document.createElement("span");
    num.className = "move-num";
    num.textContent = `${i + 1}`;

    // 2) Imagen
    const img = document.createElement("img");
    img.src = pieceImages[m.piece];
    img.alt = m.piece;
    img.draggable = false;

    // 3) Texto del movimiento
    const text = document.createElement("span");
    text.className = "move-text";
    const arrow = m.capture ? "×" : "→";
    text.textContent = `${rcToAlgebraic(m.from)} ${arrow} ${rcToAlgebraic(m.to)}`;

    entry.appendChild(num);
    entry.appendChild(img);
    entry.appendChild(text);

    hist.appendChild(entry);
  }
}

// Timers
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
}
function updateTimersDisplay() {
  const disp = (sec) => (Number.isFinite(sec) ? formatTime(sec) : "∞");

  if (humanColor === "w") {
    player1TimerEl && (player1TimerEl.textContent = disp(timers.b));
    player2TimerEl && (player2TimerEl.textContent = disp(timers.w));
  } else {
    player1TimerEl && (player1TimerEl.textContent = disp(timers.w));
    player2TimerEl && (player2TimerEl.textContent = disp(timers.b));
  }
}
function startTimer(color) {
  if (!Number.isFinite(timers[color])) return;

  lastTick[color] = Date.now();
  timerIntervals[color] = setInterval(() => {
    const now = Date.now();
    const delta = now - lastTick[color];

    if (delta >= 1000) {
      const secs = Math.floor(delta / 1000);
      timers[color] -= secs;
      lastTick[color] += secs * 1000;
      updateTimersDisplay();

      if (timers[color] <= 0) {
        clearInterval(timerIntervals[color]);
        const winnerColor = color === "w" ? "b" : "w"; // el rival gana
        const winnerName = winnerColor === "w" ? "Rosas" : "Azules";
        showEndGameModal(winnerName + " ganan por tiempo", winnerColor);
      }
    }
  }, 500);
}
function stopTimer(color) {
  clearInterval(timerIntervals[color]);
}

function switchTurn() {
  if (isReviewMode) return;

  stopTimer(currentTurn);
  currentTurn = currentTurn === "w" ? "b" : "w";
  startTimer(currentTurn);
  setTurnLED();

  // Local vs robot: si no es online y no es tu turno, juega stockfish
  if (!isOnlineGame && currentTurn !== humanColor && !isReviewMode) {
    setRobotThinking(true);
    requestStockfishMove();
  } else {
    setRobotThinking(false); // Por si vuelves al humano
  }
}

function finishMove() {
  updateKingStatus();

  const opp = currentTurn === "w" ? "b" : "w";

  // Mate
  if (isKingInCheck(opp) && isCheckmate(opp)) {
    currentHealth[opp] = 0;
    updateHealthBar();
    playSound(checkmateSound, "checkmate");
    showCheckmateAnimation();
    setTimeout(() => {
      showEndGameModal(
        (currentTurn === humanColor ? "Humano" : "Rival/Robot") +
          " gana por jaque mate",
        currentTurn // <- ganador: el que acaba de mover
      );
    }, 900);

    return;
  }

  // Jaque
  if (isKingInCheck(opp)) {
    showCheckAnimation();
    playSound(checkSound, "check");
  }

  // Tablas
  if (!isKingInCheck(opp) && isStalemate(opp)) {
    stopTimer(currentTurn);
    showEndGameModal("Tablas por rey ahogado");
    return;
  }

  if (isInsufficientMaterial()) {
    stopTimer(currentTurn);
    showEndGameModal("Tablas por insuficiencia de material");
    return;
  }

  // Snapshot + repetición
  updatePositionHistory();
  const key = repetitionKey();
  repetitionCount.set(key, (repetitionCount.get(key) || 0) + 1);
  if (repetitionCount.get(key) >= 3) {
    stopTimer(currentTurn);
    showEndGameModal("Tablas por triple repetición");
    return;
  }

  switchTurn();
}

// ============================================================
// 11) DRAG & DROP
// ============================================================

let dragClone = null;
let dragOrigin = null;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragOffset = { x: 0, y: 0 };
const DRAG_THRESHOLD = 5;

function onPointerDown(e) {
  if (processingQueue || onlineMoveQueue.length) return;
  if (isAnimating) return;

  // Solo piezas del turno actual (y en online, solo si es tu turno)
  if (isOnlineGame && currentTurn !== humanColor) return;

  const cell = e.target.closest(".cell");
  if (!cell) return;

  const { row, col } = getLogicalPos(cell);
  if (!board[row][col] || board[row][col][0] !== currentTurn) return;

  e.preventDefault();

  dragOrigin = { row, col };
  dragStart = { x: e.clientX, y: e.clientY };
  isDragging = false;

  const img = cell.querySelector("img.piece");
  if (!img) return;

  img.setPointerCapture?.(e.pointerId);
  img.addEventListener("pointermove", onPointerMove);
  img.addEventListener("pointerup", onPointerUp);
  img.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(e) {
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;

  const origImg = e.currentTarget;

  if (!isDragging) {
    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;

    // Inicia drag
    isDragging = true;

    removeLastMoveHighlights();
    removeMoveIndicators();

    const rect = origImg.getBoundingClientRect();
    dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    dragClone = origImg.cloneNode(true);
    Object.assign(dragClone.style, {
      position: "fixed",
      left: `${e.clientX - dragOffset.x}px`,
      top: `${e.clientY - dragOffset.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: 0,
      pointerEvents: "none",
      zIndex: 9999,
      willChange: "transform, left, top",
    });
    document.body.appendChild(dragClone);

    // En vez de visibility:hidden, usamos opacity:0 temporal
    origImg.style.opacity = "0";
    origImg.style.visibility = "visible";

    showLegalMoves(dragOrigin);
  }

  if (!dragClone) return;

  dragClone.style.left = `${e.clientX - dragOffset.x}px`;
  dragClone.style.top = `${e.clientY - dragOffset.y}px`;
}

function onPointerUp(e) {
  const origImg = e.currentTarget;

  origImg.releasePointerCapture?.(e.pointerId);
  origImg.removeEventListener("pointermove", onPointerMove);
  origImg.removeEventListener("pointerup", onPointerUp);
  origImg.removeEventListener("pointercancel", onPointerUp);

  // Restore original img visual ASAP
  origImg.style.opacity = "1";
  origImg.style.visibility = "visible";

  if (isDragging) {
    const dropEl = document.elementFromPoint(e.clientX, e.clientY);
    const dropCell = dropEl ? dropEl.closest(".cell") : null;

    if (dropCell) {
      const to = getLogicalPos(dropCell);
      const piece = board?.[dragOrigin?.row]?.[dragOrigin?.col];

      // Movimiento válido => ejecuta
      if (piece && isValidMove(dragOrigin, to)) {
        movePieceNoAnim(dragOrigin, to, true);
      } else {
        // =========================
        // ✅ BLINDAJE REY (CRÍTICO)
        // =========================
        if (piece && piece[1] === "k") {
          const dRow = to.row - dragOrigin.row;
          const dCol = to.col - dragOrigin.col;

          const isSingleStep = Math.abs(dRow) <= 1 && Math.abs(dCol) <= 1;
          const isCastlingGeometry = dRow === 0 && Math.abs(dCol) === 2;

          // Si NO es paso de 1 casilla y NO es enroque => error simple SIEMPRE
          if (!isSingleStep && !isCastlingGeometry) {
            blinkCell(dropCell);
          } else {
            // Aquí sí procede evaluar amenaza para el rey (paso/enroque)
            if (isSquareAttacked(to, currentTurn)) {
              playSound(errorSound, "error");
              // rey amenazado: marca rey + amenaza (tu helper)
              // (si tu helper espera "kingPos" y "attackerPos", puedes ajustar)
              showKingThreatAnimation(to, to);
            } else {
              blinkCell(dropCell);
            }
          }
          cleanupDrag();
          return;
        }

        // ==========================================
        // ✅ PIEZA CLAVADA / DEJA AL REY EN JAQUE
        // (solo si el movimiento respeta geometría,
        //  para no disparar animación en movimientos
        //  absurdos tipo alfil recto, torre diagonal)
        // ==========================================
        if (piece) {
          // Si la geometría del movimiento es imposible, error simple
          if (!isPseudoLegalByType(dragOrigin, to, piece)) {
            blinkCell(dropCell);
            cleanupDrag();
            return;
          }

          const kingPos = findKingPosition(currentTurn);

          if (kingPos) {
            const leaves = simulateMove(dragOrigin, to, () =>
              isKingInCheck(currentTurn),
            );
            if (leaves) {
              playSound(errorSound, "error");
              showExposedKingThreatAfterMove(dragOrigin, to, currentTurn);
            } else {
              blinkCell(dropCell);
            }
          } else {
            blinkCell(dropCell);
          }

          cleanupDrag();
          return;
        }
        // Fallback
        blinkCell(dropCell);
      }
    }
  }

  cleanupDrag();
}

function cleanupDrag() {
  removeMoveIndicators();

  if (dragClone) {
    dragClone.remove();
    dragClone = null;
  }

  isDragging = false;
  dragOrigin = null;
}

// Backup: si sueltas fuera del img
document.addEventListener("pointerup", (e) => {
  if (isDragging) {
    // deja que onPointerUp real haga su trabajo; aquí solo limpiamos si quedó colgado
    setTimeout(() => {
      if (isDragging) cleanupDrag();
    }, 0);
  }
});

function goToHistoryIndex(i) {
  if (!positionHistory.length) return;
  i = Math.max(0, Math.min(positionHistory.length - 1, i));
  currentHistoryIndex = i;

  const snap = positionHistory[i];
  if (!snap) return;

  if (snap.snapshot) {
    board = snap.snapshot.map((r) => r.slice());
  }

  currentTurn = snap.lastMoveBy
    ? snap.lastMoveBy === "w"
      ? "b"
      : "w"
    : currentTurn;

  currentHealth = { ...snap.health };
  scores = { ...snap.scores };

  kingMoved = { ...snap.castling.kingMoved };
  rookMoved = {
    w: { ...snap.castling.rookMoved.w },
    b: { ...snap.castling.rookMoved.b },
  };

  renderBoard();

  // --- VFX/SFX al navegar por historial ---
  // Usa isNavigating (más fiable que isReviewMode en edge cases)
  if (isNavigating) {
    const lastMove = i > 0 ? moveList[i - 1] : null;

    if (lastMove) {
      // Sonido
      try {
        if (lastMove.capture) playSound(captureSound, "capture");
        else playSound(moveSound, "move");
      } catch (_) {}

      // Explosión solo si fue captura
      if (lastMove.capture) {
        try {
          requestAnimationFrame(() => {
            createCapturedPieceExplosion(lastMove.capture, lastMove.to);
          });
        } catch (_) {}
      }
    }
  }

  updateHealthBar();
  updateScores();
  updateKingStatus();
  setTurnLED();
  maybeExitReviewAtEnd();
}

function handleHistoryStep(direction) {
  if (!positionHistory.length) return;
  if (isAnimating || isNavigating) return;

  const maxIdx = positionHistory.length - 1;
  const fromIdx = currentHistoryIndex;
  const toIdx =
    direction === "next"
      ? Math.min(maxIdx, fromIdx + 1)
      : Math.max(0, fromIdx - 1);

  if (toIdx === fromIdx) return;

  // Entra en review y bloquea input mientras animamos
  enterReviewMode();
  isNavigating = true;
  startAnimationLock();

  // Fuente del movimiento según relación snapshots<->moves:
  // snapshot 0 = estado inicial; snapshot i = después de i movimientos.
  // Por tanto, mover "next" usa moveList[fromIdx], mover "prev" usa moveList[fromIdx - 1].
  const mv = direction === "next" ? moveList[fromIdx] : moveList[fromIdx - 1];

  // Si no hay moveRecord (desfase), fallback a salto directo sin animación
  if (!mv) {
    goToHistoryIndex(toIdx);
    isNavigating = false;
    endAnimationLock();
    return;
  }

  // Pon el tablero en el snapshot "origen" y renderiza antes de animar
  const snapFrom = positionHistory[fromIdx];
  const snapTo = positionHistory[toIdx];

  if (snapFrom?.snapshot) {
    board = snapFrom.snapshot.map((r) => r.slice());
  }
  renderBoard();

  // Determina from/to para la animación según dirección
  const aFrom = direction === "next" ? mv.from : mv.to;
  const aTo = direction === "next" ? mv.to : mv.from;

  const fromCell = getCell(aFrom.row, aFrom.col);
  const toCell = getCell(aTo.row, aTo.col);

  // SFX (simple pero consistente)
  const isCapture = !!mv.capture;
  const isPawn = mv.piece && mv.piece[1] === "p";
  const isPromoForward =
    direction === "next" && isPawn && (aTo.row === 0 || aTo.row === 7);

  // Enroque (detectable por rey moviéndose 2 columnas)
  const isCastling =
    mv.piece && mv.piece[1] === "k" && Math.abs(mv.to.col - mv.from.col) === 2;

  // Helper de “consolidación” al final
  const commitToSnapshot = () => {
    if (snapTo?.snapshot) {
      board = snapTo.snapshot.map((r) => r.slice());
    }

    // Recalcula turno/flags/vida/scores desde snapshot destino
    currentHistoryIndex = toIdx;
    renderMoveHistoryUI();

    currentTurn = snapTo.lastMoveBy
      ? snapTo.lastMoveBy === "w"
        ? "b"
        : "w"
      : currentTurn;

    currentHealth = { ...snapTo.health };
    scores = { ...snapTo.scores };

    kingMoved = { ...snapTo.castling.kingMoved };
    rookMoved = {
      w: { ...snapTo.castling.rookMoved.w },
      b: { ...snapTo.castling.rookMoved.b },
    };

    renderBoard();
    updateHealthBar();
    updateScores();
    updateKingStatus();
    setTurnLED();

    isNavigating = false;
    endAnimationLock();

    // Si ya estás al final, sales de review y vuelves al “live game”
    maybeExitReviewAtEnd();
  };

  // Si no hay DOM para animar, fallback a commit directo
  if (!fromCell || !toCell) {
    commitToSnapshot();
    return;
  }

  // En forward-capture, elimina víctima del DOM y dispara VFX antes de animar
  if (direction === "next" && isCapture && toCell) {
    // VFX (explosión) usando el código de la pieza capturada
    try {
      // mv.capture es el code tipo "bp", "wn", etc.
      createCapturedPieceExplosion?.(mv.capture, aTo);
    } catch (_) {}

    // Quita la víctima del DOM para evitar duplicados durante la animación
    const victimImg = toCell.querySelector("img.piece");
    if (victimImg) victimImg.remove();
  }

  // Sonidos (mínimo viable)
  if (isPromoForward) {
    playSound(promotionSound, "promotion");
  } else if (isCapture) {
    // Captura: solo sonido de captura al avanzar
    // Al retroceder, suena como movimiento normal
    playSound(
      direction === "next" ? captureSound : moveSound,
      direction === "next" ? "capture" : "move",
    );
  } else {
    playSound(moveSound, "move");
  }

  // Enroque: anima rey + torre
  if (isCastling) {
    const row = mv.from.row; // misma fila siempre
    const kingFrom = direction === "next" ? mv.from : mv.to;
    const kingTo = direction === "next" ? mv.to : mv.from;

    // Determina columnas torre según lado (corto: g-file / largo: c-file)
    const rookFromCol = kingTo.col === 6 ? 7 : 0;
    const rookToCol = kingTo.col === 6 ? 5 : 3;

    // Si vamos hacia atrás, intercambia origen/destino de torre también
    const rFrom =
      direction === "next"
        ? { row, col: rookFromCol }
        : { row, col: rookToCol };
    const rTo =
      direction === "next"
        ? { row, col: rookToCol }
        : { row, col: rookFromCol };

    const kFromCell = getCell(kingFrom.row, kingFrom.col);
    const kToCell = getCell(kingTo.row, kingTo.col);
    const rFromCell = getCell(rFrom.row, rFrom.col);
    const rToCell = getCell(rTo.row, rTo.col);

    const kImg = kFromCell?.querySelector("img.piece");
    const rImg = rFromCell?.querySelector("img.piece");

    if (!kImg || !rImg || !kFromCell || !kToCell || !rFromCell || !rToCell) {
      commitToSnapshot();
      return;
    }

    let done = 0;
    const onDone = () => {
      done += 1;
      if (done < 2) return;
      commitToSnapshot();
    };

    animatePieceMove(kImg, kFromCell, kToCell, onDone);
    animatePieceMove(rImg, rFromCell, rToCell, onDone);
    return;
  }

  // Movimiento normal: anima la pieza que esté en fromCell
  const movingPieceElem = fromCell.querySelector("img.piece");
  if (!movingPieceElem) {
    commitToSnapshot();
    return;
  }

  animatePieceMove(movingPieceElem, fromCell, toCell, () => {
    commitToSnapshot();
  });
}

// HISTORIAL: helpers + navegación + UI
function bindHistoryScrollButtons() {
  const wrapper = document.querySelector(".move-history-wrapper");
  const hist = document.querySelector(".move-history");
  if (!wrapper || !hist) return;

  const btns = wrapper.querySelectorAll(".history-btn");
  if (btns.length < 2) return;

  const btnLeft = btns[0];
  const btnRight = btns[btns.length - 1];

  const step = () => Math.max(120, Math.floor(hist.clientWidth * 0.6));

  btnLeft.addEventListener("pointerup", (e) => {
    e.preventDefault();
    hist.scrollBy({ left: -step(), behavior: "smooth" });
  });

  btnRight.addEventListener("pointerup", (e) => {
    e.preventDefault();
    hist.scrollBy({ left: step(), behavior: "smooth" });
  });
}

// HISTORIAL – BOTONES PREV / NEXT
$("btnPrev")?.addEventListener("pointerup", () => {
  handleHistoryStep("prev");
});

$("btnNext")?.addEventListener("pointerup", () => {
  handleHistoryStep("next");
});

// ============================================================
// 12) CHAT ONLINE (UI + submit + renderer)
// ============================================================

// Estado badge
const seenChatIds = new Set();
let unreadChatCount = 0;

function getChatEls() {
  return {
    chatPanel: document.getElementById("chatPanel"),
    chatModal: document.getElementById("chatModal"),
    chatMessages: document.getElementById("chatMessages"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    btnChat: document.getElementById("btnChat"),
    chatClose: document.getElementById("chatClose"),
    chatBadge: document.getElementById("chatBadge"),
  };
}

function setChatBadge(n) {
  const { chatBadge } = getChatEls();
  unreadChatCount = Math.max(0, n | 0);
  if (!chatBadge) return;

  if (unreadChatCount <= 0) {
    chatBadge.classList.add("hidden");
  } else {
    chatBadge.textContent = String(unreadChatCount);
    chatBadge.classList.remove("hidden");
  }
}

function isChatOpen() {
  const { chatPanel, chatModal } = getChatEls();
  if (chatModal) return !chatModal.classList.contains("hidden");
  if (chatPanel) return !chatPanel.classList.contains("hidden");
  return false;
}

function rememberChatId(id) {
  if (!id) return;
  seenChatIds.add(id);
  if (seenChatIds.size > 300) {
    const first = seenChatIds.values().next().value;
    seenChatIds.delete(first);
  }
}

function appendChatMessage(msg) {
  const { chatMessages } = getChatEls();
  if (!chatMessages) {
    console.warn("[CHAT] chatMessages NO existe en DOM");
    return;
  }

  if (!msg) return;
  if (msg.id && seenChatIds.has(msg.id)) return;
  if (msg.id) rememberChatId(msg.id);

  const isMe = socket && msg.from === socket.id;

  const wrap = document.createElement("div");
  wrap.className = "chat-msg " + (isMe ? "me" : "them");

  if (msg.id) wrap.dataset.msgId = msg.id;
  wrap.dataset.status = msg.status || "";

  const meta = document.createElement("div");
  meta.className = "chat-meta";

  const who = isMe ? "Tú" : "Rival";
  const t = new Date(msg.ts || Date.now());
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  meta.textContent = `${who} · ${hh}:${mm}`;

  if (isMe && msg.status === "sending") meta.textContent += " · enviando…";
  if (isMe && msg.status === "ok") meta.textContent += " · ✓";
  if (isMe && msg.status === "fail") meta.textContent += " · ✗";

  const body = document.createElement("div");
  body.textContent = String(msg.text || "");

  wrap.appendChild(meta);
  wrap.appendChild(body);
  chatMessages.appendChild(wrap);

  // Unread badge solo si NO soy yo y chat no está abierto
  if (!isMe && !isChatOpen()) {
    setChatBadge(unreadChatCount + 1);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function initChatUI() {
  const { chatPanel, chatModal, chatForm, chatInput, btnChat, chatClose } =
    getChatEls();

  // Si existe panel, lo ocultamos por defecto (se muestra al entrar en startGame)
  chatPanel?.classList.add("hidden");

  // Si existe modal + botón, restauramos UX de antes
  if (btnChat && chatModal) {
    btnChat.addEventListener("pointerup", () => {
      chatModal.classList.remove("hidden");
      setTimeout(() => chatInput?.focus(), 0);
      setChatBadge(0);
    });

    chatClose?.addEventListener("pointerup", () =>
      chatModal.classList.add("hidden"),
    );

    chatModal.addEventListener("pointerup", (e) => {
      if (e.target === chatModal) chatModal.classList.add("hidden");
    });
  } else {
    // Si NO hay modal/botón, avisa (esto explica tu “ya no hay botón”)
    console.warn(
      "[CHAT] No existe btnChat/chatModal -> chat será inline (si el HTML lo muestra)",
    );
  }

  // Bind submit una sola vez
  if (!chatForm || !chatInput) {
    console.warn("[CHAT] faltan nodos form/input");
    return;
  }
  if (chatForm.dataset.bound === "1") return;
  chatForm.dataset.bound = "1";

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    e.stopPropagation();

    console.log("[CHAT] submit interceptado", { isOnlineGame, currentRoomId });

    if (!isOnlineGame || !currentRoomId) return;

    const text = (chatInput.value || "").trim();
    if (!text) return;

    const s = ensureSocket();
    if (!s || !s.connected) {
      console.warn("[CHAT] socket no conectado");
      return;
    }

    const ts = Date.now();
    const id =
      crypto?.randomUUID?.() || `${ts}-${Math.random().toString(16).slice(2)}`;

    // Optimistic UI SIEMPRE
    appendChatMessage({ id, from: s.id, text, ts, status: "sending" });

    console.log("[CHAT] emit chatMessage", { roomId: currentRoomId, id });

    s.emit("chatMessage", { roomId: currentRoomId, id, text, ts }, (ack) => {
      console.log("[CHAT] ack:", ack);
      const node = document.querySelector(`.chat-msg[data-msg-id="${id}"]`);

      if (!ack?.ok) {
        if (node) {
          node.dataset.status = "fail";
          const meta = node.querySelector(".chat-meta");
          if (meta) meta.textContent += " · ✗";
        }
        return;
      }

      // ok
      if (node) {
        node.dataset.status = "ok";
        const meta = node.querySelector(".chat-meta");
        if (meta && !meta.textContent.includes("✓")) meta.textContent += " · ✓";
      }

      chatInput.value = "";
    });
  });
}

// ============================================================
// 13) MODALES (endgame + resign) + reset helpers
// ============================================================

const btnSurrender = $("btnSurrender");
btnSurrender?.addEventListener("pointerup", (e) => {
  e.preventDefault();
  showResignConfirmModal();
});

function showEndGameModal(message, winnerColor = null) {
  const overlay = document.createElement("div");
  overlay.id = "endGameModal";

  const content = document.createElement("div");
  content.classList.add("modal-content", "endgame-content");
  content.style.position = "relative";

  const closeBtn = document.createElement("button");
  closeBtn.classList.add("modal-close-btn");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("pointerup", () => overlay.remove());
  content.appendChild(closeBtn);

  const title = document.createElement("h2");
  title.textContent = "FIN DE LA PARTIDA";
  content.appendChild(title);
    // Avatar del ganador (si se conoce el color)
  if (winnerColor) {
    const avatarSrc = getWinnerAvatarSrc(winnerColor);

    if (avatarSrc) {
      const avatar = document.createElement("img");
      avatar.src = avatarSrc;
      avatar.alt = "Ganador";
      avatar.draggable = false;

      avatar.style.cssText = `
        width: 90px;
        height: 90px;
        border-radius: 12px;
        margin: 12px auto;
        display: block;
        border: 2px solid rgb(79,246,255);
        box-shadow: 0 0 15px rgb(79,246,255);
        object-fit: cover;
      `;

      content.appendChild(avatar);
    }
  }

  const msg = document.createElement("p");
  msg.textContent = message;
  content.appendChild(msg);

  const btns = document.createElement("div");
  btns.classList.add("modal-btn-container");

  const rep = document.createElement("button");
  rep.textContent = "Repetir partida";
  rep.classList.add("btn");
  rep.addEventListener("pointerup", () => {
    overlay.remove();
    repeatGame();
  });

  const volver = document.createElement("button");
  volver.textContent = "Volver al menú";
  volver.classList.add("btn");
  volver.addEventListener("pointerup", () => {
    localStorage.removeItem("NEONCHESS_ROOM");
    localStorage.removeItem("NEONCHESS_ONLINE");
    window.location.reload();
  });

  btns.append(rep, volver);
  content.appendChild(btns);

  overlay.appendChild(content);
  document.body.appendChild(overlay);
}

function showResignConfirmModal() {
  const overlay = document.createElement("div");
  overlay.id = "resignConfirmModal";
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: #121c4095;
    display: flex; align-items: center; justify-content: center;
    z-index: 999999;
  `;

  const content = document.createElement("div");
  content.classList.add("modal-content", "endgame-content");
  content.style.cssText = `
    width: 80%;
    max-width: 520px;
    background: #121c40;
    padding: 20px;
    text-align: center;
    margin: 10px;
    border: 2px solid rgb(79, 246, 255);
    box-shadow: 0px 0px 10px rgb(79, 246, 255);
    border-radius: 6px;
    position: relative;
  `;

  const closeBtn = document.createElement("button");
  closeBtn.classList.add("modal-close-btn");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("pointerup", () => overlay.remove());
  content.appendChild(closeBtn);

  const title = document.createElement("h2");
  title.textContent = "¿CONFIRMAR RENDICIÓN?";
  content.appendChild(title);

  const msg = document.createElement("p");
  msg.textContent = "Si confirmas, la partida terminará por rendición.";
  content.appendChild(msg);

  const btns = document.createElement("div");
  btns.classList.add("modal-btn-container");

  const cancel = document.createElement("button");
  cancel.textContent = "Cancelar";
  cancel.classList.add("btn");
  cancel.addEventListener("pointerup", () => overlay.remove());

  const confirm = document.createElement("button");
  confirm.textContent = "Rendirse";
  confirm.classList.add("btn");
  confirm.addEventListener("pointerup", () => {
    overlay.remove();

    if (isOnlineGame && currentRoomId) {
      ensureSocket()?.emit("resign", { roomId: currentRoomId });
    }

    stopTimer("w");
    stopTimer("b");
    const winnerColor = currentTurn === "w" ? "b" : "w";
    showEndGameModal("Rendición. Fin de la partida.", winnerColor);
  });

  btns.append(cancel, confirm);
  content.appendChild(btns);

  overlay.appendChild(content);
  document.body.appendChild(overlay);
}

// Reset / repeat (si no los pegaste ya)
function repeatGame() {
  teardownSocket();
  // 🧹 Reset persistencia online (repeat = nueva partida limpia)
  localStorage.removeItem("NEONCHESS_ROOM");
  localStorage.removeItem("NEONCHESS_ONLINE");

  stopTimer("w");
  stopTimer("b");

  isReviewMode = false;
  isNavigating = false;
  selectedCell = null;
  removeMoveIndicators();
  removeLastMoveHighlights();

  kingMoved = { w: false, b: false };
  rookMoved = {
    w: { left: false, right: false },
    b: { left: false, right: false },
  };
  enPassantTarget = null;

  maxHealth = { w: 39 + kingBaseHealth, b: 39 + kingBaseHealth };
  currentHealth = { ...maxHealth };
  scores = { w: 0, b: 0 };
  updateScores();
  updateHealthBar();

  const hist = document.querySelector(".move-history");
  if (hist) hist.innerHTML = "";

  moveList = [];
  positionHistory = [];
  currentHistoryIndex = 0;

  currentTurn = "w";
  if (selectedTime == null || isNaN(selectedTime)) selectedTime = Infinity;
  timers = { w: selectedTime, b: selectedTime };
  updateTimersDisplay();

  setupInitialBoard();
  renderBoard();
  updateKingStatus();

  if (Number.isFinite(timers[currentTurn])) startTimer(currentTurn);

  repetitionCount.clear();
  setTurnLED();
}

// ============================================================
// 14) STOCKFISH: request + bestmove handling
// ============================================================

function boardToFen() {
  // FEN piezas
  let fen = "";
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) {
        empty++;
        continue;
      }
      if (empty) {
        fen += empty;
        empty = 0;
      }
      const color = p[0];
      const type = p[1];
      const map = { p: "p", n: "n", b: "b", r: "r", q: "q", k: "k" };
      let ch = map[type] || "p";
      if (color === "w") ch = ch.toUpperCase();
      fen += ch;
    }
    if (empty) fen += empty;
    if (r !== 7) fen += "/";
  }

  // Turno
  const turn = currentTurn === "w" ? "w" : "b";

  // Enroque (desde tus flags)
  let castle = "";
  if (!kingMoved.w && !rookMoved.w.right) castle += "K";
  if (!kingMoved.w && !rookMoved.w.left) castle += "Q";
  if (!kingMoved.b && !rookMoved.b.right) castle += "k";
  if (!kingMoved.b && !rookMoved.b.left) castle += "q";
  if (!castle) castle = "-";

  // En passant
  const ep = enPassantTarget ? rcToAlgebraic(enPassantTarget) : "-";

  // halfmove / fullmove (simplificados)
  const halfmove = 0;
  const fullmove = 1;

  return `${fen} ${turn} ${castle} ${ep} ${halfmove} ${fullmove}`;
}

function requestStockfishMove() {
  if (isOnlineGame) return; // robot solo en local
  if (!stockfishWorker) initStockfish();
  if (!stockfishWorker) return;

  const fen = boardToFen();

  const level = Math.max(1, Math.min(10, difficultyLevel || 1));
  const skill = getSkillForLevel(level);
  const movetime = getMovetimeForLevel(level);

  DEBUG &&
    console.log("[SF] fen:", fen, "skill:", skill, "movetime:", movetime);

  // Inicializa UCI (por si el worker arranca frío)
  stockfishWorker.postMessage("uci");
  stockfishWorker.postMessage("isready");

  // Ajustes de nivel
  stockfishWorker.postMessage(`setoption name Skill Level value ${skill}`);

  // Posición y búsqueda
  stockfishWorker.postMessage(`position fen ${fen}`);
  stockfishWorker.postMessage(`go movetime ${movetime}`);
}

function processBestMove(best) {
  setRobotThinking(false);

  // bestmove e2e4 | e7e8q etc
  if (!best || best === "(none)") return;

  const fromAlg = best.slice(0, 2);
  const toAlg = best.slice(2, 4);

  const from = algebraicToRC(fromAlg);
  const to = algebraicToRC(toAlg);

  // Si hay promo: best[4] => q/r/b/n (aquí lo ignoramos y dejamos tu lógica actual)
  // Si quieres promo UI real, lo añadimos luego.

  // movimiento robot => isHumanMove=false
  movePiece(from, to, false);
}

// Badge simple de dificultad (si existe el elemento)
function updateRobotDifficultyBadge(level) {
  const el = $("robotDifficulty"); // ✅ este es tu HTML real
  if (!el) return;
  el.textContent = `Nivel ${Math.max(1, Math.min(10, level || 1))}`;
}

// ============================================================
// 15) STARTERS: actuallyStartGame + playButton + init timers
// ============================================================

function actuallyStartGame() {
  seenMoveIds.clear();
  lastAppliedSeq = 0;
  onlineMoveQueue = [];
  processingQueue = false;

  // Reseteos generales de estado de partida
  isReviewMode = false;
  isNavigating = false;
  selectedCell = null;
  removeMoveIndicators();
  removeLastMoveHighlights();

  // Reseteo de flags críticos
  kingMoved = { w: false, b: false };
  rookMoved = {
    w: { left: false, right: false },
    b: { left: false, right: false },
  };
  enPassantTarget = null;

  repetitionCount.clear();

  // Salud y score
  maxHealth = { w: 39 + kingBaseHealth, b: 39 + kingBaseHealth };
  currentHealth = { ...maxHealth };
  scores = { w: 0, b: 0 };
  updateScores();
  updateHealthBar();

  // Turno inicial
  currentTurn = "w";

  // Timers
  let t = selectedTime;
  if (t == null || !Number.isFinite(t)) t = Infinity;
  timers = { w: t, b: t };
  updateTimersDisplay();

  // Tablero
  setupInitialBoard();
  renderBoard();
  updateKingStatus();
  setTurnLED();

  // Arranca timer de blancas si es finito
  if (Number.isFinite(timers[currentTurn])) startTimer(currentTurn);

  // Si es local vs robot y el humano eligió negras, el robot mueve primero
  if (!isOnlineGame && humanColor === "b") {
    requestStockfishMove();
  }

  if (!isOnlineGame) $("connStatus")?.classList.add("hidden");
  else $("connStatus")?.classList.remove("hidden");

  updateRobotDifficultyBadge(difficultyLevel);

  // Ocultar el indicador de conexión en modo local
  if (!isOnlineGame) $("connStatus")?.classList.add("hidden");

  refreshConnVisibility();
}

// playButton (modo local)
playButton?.addEventListener("pointerup", () => {
  teardownSocket();
  // 🧹 Limpia estado online persistido
  localStorage.removeItem("NEONCHESS_ROOM");
  localStorage.removeItem("NEONCHESS_ONLINE");

  // si vienes de local/robot
  isOnlineGame = false;
  currentRoomId = null;
  refreshConnVisibility();

  // ✅ OFFLINE: oculta indicador de conexión (si existe)
  $("connStatus")?.classList.add("hidden");

  // ✅ OFFLINE: muestra badge del robot (si existe)
  $("difficultyBadge")?.classList.remove("hidden");

  // ✅ OFFLINE: si tienes labels de perfil, ajusta aquí (opcionales)
  // $("opponentName") && ($("opponentName").textContent = "Robot");
  // $("playerName") && ($("playerName").textContent = "Tú");

  // Oculta setup/menu si existe
  const gameSetup = $("gameSetup");
  gameSetup?.classList.add("hidden");
  if (gameSetup) gameSetup.style.display = "none";

  // Oculta header si lo usas
  document.querySelector("header")?.classList.add("hidden");
  document.body.classList.add("game-active");

  // Muestra el tablero/contenedor
  $("gameContainer")?.classList.remove("hidden");
  document.querySelector(".chess-container")?.classList.remove("hidden");
  document.querySelector(".move-history-wrapper")?.classList.remove("hidden");

  // Música
  try {
    menuMusic.pause();
    playGameMusic();
  } catch (_) {}

  actuallyStartGame();
});

// ============================================================
// 16) ARRANQUE GLOBAL (DOMContentLoaded)
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  try {
    initAnimatedBackground();
    initVisualTheme();
    updateColorOptionImages();
    initGeneralUI();
    initUISetup();
    bindButtonSfx();
    initChatUI();
    bindHistoryScrollButtons();
    setConn("offline");

    revealAppWhenStable();
  } catch (err) {
    console.error("[BOOT] error:", err);
  }
});

// Seguridad: si cierran pestaña en online, avisa al server (opcional)
window.addEventListener("beforeunload", () => {
  try {
    if (isOnlineGame && currentRoomId && socket?.connected) {
      socket.emit("resign", { roomId: currentRoomId });
    }
  } catch (_) {}
});
