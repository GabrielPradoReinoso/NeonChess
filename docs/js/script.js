// js/script.js

// ============================================================
// ÍNDICE DE BLOQUES
// ============================================================
/*
 0) IMPORTS Y ARRANQUE
 1) MOTOR STOCKFISH (worker + helpers UCI)
 2) MULTIJUGADOR ONLINE (Socket.IO + salas)
 3) DROPDOWNS DE CONFIGURACIÓN (dificultad / color / tiempo)
 4) LOADING OVERLAY (página completa)
 5) OVERLAY PRE-PARTIDA (barra de carga fake)
 6) ANIMACIÓN "MATRIX" DEL ROBOT
 7) CONFIGURACIÓN DE DIFICULTAD + BADGE
 8) MÚSICA Y SONIDOS
 9) MENÚ DESPLEGABLE DEL HEADER
10) HELPERS GENERALES (addEventMulti, estilos, sonidos de botones)
11) VARIABLES GLOBALES Y SELECTORES DOM
12) HISTORIAL DE POSICIONES (snapshots, insuficiencia de material)
13) BARRA DE SALUD
14) MARCADORES DE MOVIMIENTO + RESALTADO ÚLTIMO MOVIMIENTO
15) GENERACIÓN Y RENDERIZADO DEL TABLERO (getCell, snapshots)
16) ANIMACIONES DE AMENAZA AL REY
17) REGLAS DE MOVIMIENTO Y ATAQUES
18) MOVER PIEZA (animado) + CAPTURAS + PROMOCIÓN
19) MANEJO DE CLICK EN CELDA (incl. jaque descubierto)
20) DRAG & DROP MEJORADO
21) EFECTOS VISUALES (explosión, check, checkmate)
22) FINALIZAR MOVIMIENTO Y MODALES DE PARTIDA
23) TIMERS
24) PUNTUACIÓN, REY, ERRORES Y CAMBIO DE TURNO
25) HISTORIAL DE MOVIMIENTOS (UI, navegación, scroll)
26) INICIO Y RESETEO DE PARTIDA
*/

document.addEventListener("DOMContentLoaded", function () {
  // ==========================================================
  // 1) MOTOR STOCKFISH (worker + helpers UCI)
  // ==========================================================
  let stockfishWorker = null;

  function initStockfish() {
    if (stockfishWorker) stockfishWorker.terminate();

    const workerUrl = new URL("./stockfish-worker.js", import.meta.url);
    console.log("[SF] workerUrl =", workerUrl.href);

    try {
      stockfishWorker = new Worker(workerUrl);
    } catch (e) {
      console.error("[SF] new Worker() FAILED:", e);
      return;
    }

    stockfishWorker.onmessage = (e) => {
      console.log("[SF]", e.data);
      const msg = typeof e.data === "string" ? e.data : e.data?.bestmove;
      if (typeof msg === "string" && msg.startsWith("bestmove")) {
        processBestMove(msg.split(" ")[1]);
      }
    };

    stockfishWorker.onerror = (err) => {
      console.error("[SF] Worker error:", err);
    };

    stockfishWorker.onmessageerror = (err) => {
      console.error("[SF] Worker message error:", err);
    };
  }

  // ==========================================================
  // 2) MULTIJUGADOR ONLINE (Socket.IO + salas)
  // ==========================================================
  /* const isHosting =
    location.hostname.endsWith(".web.app") ||
    location.hostname.endsWith(".firebaseapp.com");

  // URL del servicio de Cloud Run
  const CLOUD_RUN_URL = "https://chess-socket-mbzdrwz7ga-ew.a.run.app";
  // Server local (node / server.js escucha en 8080)
  const LOCAL_SOCKET_URL = "http://localhost:8080";
 */
  /* const socket = isHosting
    ? io(CLOUD_RUN_URL, { path: "/socket.io" })
    : io(LOCAL_SOCKET_URL, { path: "/socket.io" }); */

  /* socket.on("connect", () => console.log("[io] conectado", socket.id));
  socket.on("connect_error", (err) => console.error("[io] error", err.message));

  // El rival mueve (evento recibido desde el servidor)
  socket.on("opponentMove", (move) => {
    console.log("[ON] opponentMove", move);
    movePiece(move.from, move.to, false);
  });
  */

  let onlineMoveQueue = [];
  let processingQueue = false;

  const isHosting =
    location.hostname.endsWith(".web.app") ||
    location.hostname.endsWith(".firebaseapp.com");

  const CLOUD_RUN_URL = "https://chess-socket-mbzdrwz7ga-ew.a.run.app";
  const LOCAL_SOCKET_URL = "http://localhost:8080";

  // 👇 NUEVO
  const IS_GITHUB_PAGES = location.hostname.endsWith("github.io");

  let socket = null;

  function ensureSocket() {
    if (socket) return socket;

    if (IS_GITHUB_PAGES) {
      console.warn(
        "[io] GitHub Pages: modo online deshabilitado (no hay servidor)."
      );
      return null;
    }

    const url = isHosting ? CLOUD_RUN_URL : LOCAL_SOCKET_URL;
    socket = io(url, { path: "/socket.io" });

    socket.on("connect", () => console.log("[io] conectado", socket.id));
    socket.on("connect_error", (err) =>
      console.error("[io] error", err.message)
    );

    socket.on("opponentMove", (move) => {
      console.log("[ON] opponentMove", move);
      movePiece(move.from, move.to, false);
    });

    socket.on("gameCreated", (roomId) => {
      currentRoomId = roomId;
      if (roomCodeText && createdRoomBox) {
        roomCodeText.textContent = roomId;
        createdRoomBox.classList.remove("hidden");
      }
    });

    socket.on("startGame", ({ roomId, color }) => {
      currentRoomId = roomId;
      humanColor = color;
      currentTurn = "w";
      onlineChoice.classList.add("hidden");
      onlineLobby.classList.add("hidden");
      gameContainer.classList.remove("hidden");
      actuallyStartGame();
    });

    socket.on("opponentResigned", () => {
      stopTimer("w");
      stopTimer("b");
      showEndGameModal("Tu rival se ha rendido.");
    });

    socket.on("invalidMove", (mv) => console.warn("Movimiento inválido:", mv));
    socket.on("gameOver", (result) => alert("Fin de la partida: " + result));

    return socket;
  }

  function enqueueOnlineMove(move) {
    onlineMoveQueue.push(move);
    processOnlineMoveQueue();
  }

  function algebraicToRC(sq) {
    const files = "abcdefgh";
    const col = files.indexOf(sq[0]);
    const row = 8 - parseInt(sq[1], 10);
    return { row, col };
  }

  function processOnlineMoveQueue() {
    if (processingQueue || isAnimating) return;
    const next = onlineMoveQueue.shift();
    if (!next) return;

    processingQueue = true;

    const from =
      typeof next.from === "string" ? algebraicToRC(next.from) : next.from;
    const to = typeof next.to === "string" ? algebraicToRC(next.to) : next.to;

    const prevFinishMove = finishMove;
    finishMove = function wrappedFinishMove() {
      prevFinishMove();
      processingQueue = false;
      setTimeout(processOnlineMoveQueue, 0);
    };

    movePiece(from, to, false);
  }

  function emitOnlineMove(from, to) {
    if (isOnlineGame && currentRoomId) {
      const payload = { roomId: currentRoomId, move: { from, to } };
      const MAX_RETRY = 2;
      let attempts = 0;

      const tryEmit = () => {
        const s = ensureSocket();
        if (!s) return;
        s.timeout(3000).emit("playerMove", payload, (err, res) => {
          if (err || !res?.ok) {
            if (attempts++ < MAX_RETRY) setTimeout(tryEmit, 500);
          }
        });
      };
      tryEmit();
    }
  }

  // ---- Flujo UI de online: crear / unirse a sala ----
  const onlineChoice = document.getElementById("onlineChoice");
  const btnCreateRoom = document.getElementById("btnCreateRoom");
  const btnJoinRoom = document.getElementById("btnJoinRoom");
  const joinCodeInput = document.getElementById("joinCodeInput");
  const createdRoomBox = document.getElementById("createdRoom");
  const roomCodeText = document.getElementById("roomCodeText");
  const copyRoomCode = document.getElementById("copyRoomCode");
  const cancelOnlineChoice = document.getElementById("cancelOnlineChoice");

  const btnOnline = document.getElementById("btnOnline");
  const btnLocal = document.getElementById("btnLocal"); // BOTÓN REAL

  if (btnLocal) {
    btnLocal.addEventListener("pointerup", () => {
      console.log("Modo robot seleccionado");

      // Reset del modo
      isOnlineGame = false;
      currentRoomId = null;

      // Ocultar pantalla inicial
      if (mainSection) mainSection.style.display = "none";

      // ⭐ MOSTRAR CONTENEDOR DEL JUEGO (menú)
      const gameContainer = document.getElementById("gameContainer");
      const gameSetup = document.getElementById("gameSetup");

      if (gameContainer) gameContainer.classList.remove("hidden");
      if (gameSetup) gameSetup.classList.remove("hidden");

      // Cerrar dropdowns invisibles
      document.querySelectorAll(".options").forEach((opt) => {
        opt.classList.remove("open");
      });

      // Ajustes por defecto
      humanColor = "w";
      selectedTime = null;

      const playButton = document.getElementById("playButton");
      if (playButton) playButton.classList.remove("hidden");

      // Asegurar que el menú se renderiza correctamente
      requestAnimationFrame(() => {
        gameSetup.style.opacity = "1";
        gameSetup.style.visibility = "visible";
        gameSetup.style.display = "block";
      });
    });
  }

  const mainSection = document.getElementById("mainSection");

  let isOnlineGame = false;
  let currentRoomId = null;

  if (btnOnline && onlineChoice) {
    btnOnline.addEventListener("pointerup", () => {
      const s = ensureSocket();
      if (!s) {
        alert(
          "El modo online no funciona en GitHub Pages. Usa modo robot/local o despliega el servidor."
        );
        return;
      }

      if (mainSection) mainSection.style.display = "none";
      onlineChoice.classList.remove("hidden");
      isOnlineGame = true;
    });
  }

  if (cancelOnlineChoice && onlineChoice) {
    cancelOnlineChoice.addEventListener("pointerup", () => {
      isOnlineGame = false;
      onlineChoice.classList.add("hidden");
      if (mainSection) mainSection.style.display = "block";
    });
  }

  if (btnCreateRoom) {
    btnCreateRoom.addEventListener("pointerup", () => {
      btnCreateRoom.disabled = true;
      ensureSocket()?.emit("newGame");
    });
  }

  /* socket.on("gameCreated", (roomId) => {
    currentRoomId = roomId;
    if (roomCodeText && createdRoomBox) {
      roomCodeText.textContent = roomId;
      createdRoomBox.classList.remove("hidden");
    }
  });

  if (copyRoomCode) {
    copyRoomCode.addEventListener("pointerup", async () => {
      try {
        await navigator.clipboard.writeText(roomCodeText.textContent);
        copyRoomCode.textContent = "¡Copiado!";
        setTimeout(() => (copyRoomCode.textContent = "Copiar"), 1200);
      } catch {}
    });
  }

  if (btnJoinRoom && joinCodeInput) {
    btnJoinRoom.addEventListener("pointerup", () => {
      const code = (joinCodeInput.value || "").trim();
      if (code) ensureSocket()?.emit("joinGame", code);
    });
  }

  // Arranque al emparejar
  socket.on("startGame", ({ roomId, color }) => {
    currentRoomId = roomId;
    humanColor = color; // 'w' o 'b'
    currentTurn = "w"; // siempre empiezan blancas
    onlineChoice.classList.add("hidden");
    onlineLobby.classList.add("hidden");
    gameContainer.classList.remove("hidden");
    actuallyStartGame();
  });

  socket.on("invalidMove", (mv) => {
    console.warn("Movimiento inválido:", mv);
  });

  socket.on("gameOver", (result) => {
    alert("Fin de la partida: " + result);
  });
 */
  // ==========================================================
  // 3) DROPDOWNS DE CONFIGURACIÓN (dificultad / color / tiempo)
  // ==========================================================
  function setupDropdown(buttonId, optionsId, onSelect) {
    const btn = document.getElementById(buttonId);
    const opts = document.getElementById(optionsId);
    if (!btn || !opts) return;

    btn.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      opts.classList.toggle("open");
    });

    opts.querySelectorAll("li").forEach((li) => {
      li.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        const label = li.dataset.label || li.textContent.trim();
        btn.textContent = label;
        opts.classList.remove("open");
        onSelect(li.dataset);
      });
    });

    document.addEventListener("pointerup", (e) => {
      if (!btn.contains(e.target) && !opts.contains(e.target)) {
        opts.classList.remove("open");
      }
    });
  }

  setupDropdown("difficultyButton", "difficultyOptions", ({ level }) => {
    difficultyLevel = parseInt(level);
    updateRobotDifficultyBadge(difficultyLevel);
  });

  setupDropdown("colorButton", "colorOptions", ({ color }) => {
    console.log("color seleccionado:", color);
    humanColor = color;
    setupInitialBoard();
  });

  setupDropdown("timeConfigButton", "timeOptions", ({ time }) => {
    selectedTime = parseInt(time) * 60;
    playButton.classList.remove("hidden");
  });

  // ==========================================================
  // 4) LOADING OVERLAY (página completa)
  // ==========================================================
  const loadingOverlay = document.getElementById("loadingOverlay");
  window.addEventListener("load", () => {
    loadingOverlay.style.opacity = 0;
    setTimeout(() => loadingOverlay.remove(), 500);
  });

  // ==========================================================
  // 5) OVERLAY PRE-PARTIDA (barra de carga fake)
  // ==========================================================
  const pregameOverlay = document.getElementById("pregameLoadingOverlay");
  const pregameProgress = document.getElementById("pregameProgress");
  const pregamePercent = document.getElementById("pregamePercent");
  const countdownOverlay = document.getElementById("countdownOverlay");
  const countdownNumber = document.getElementById("countdownNumber");
  // (countdownOverlay / countdownNumber se mantienen por si los reusas)

  // ==========================================================
  // 6) ANIMACIÓN "MATRIX" DEL ROBOT
  // ==========================================================
  let thinkingOverlay = null;

  function startRobotThinkingAnimation() {
    if (thinkingOverlay) return;
    const container = document.querySelector(
      "#player1 .matrix-overlay-player1"
    );
    container.innerHTML = "";
    thinkingOverlay = container;
    container.classList.add("visible");

    const W = container.clientWidth;
    const H = container.clientHeight;
    const cols = Math.ceil(W / 12);
    const visibleRows = Math.ceil(H / 14);
    const totalRows = visibleRows * 3;
    const pct = 100 / cols;

    for (let c = 0; c < cols; c++) {
      const dur = (2 + Math.random() * 2).toFixed(2) + "s";
      const colDiv = document.createElement("div");
      colDiv.classList.add("matrix-col");
      Object.assign(colDiv.style, {
        width: `${pct}%`,
        left: `${c * pct}%`,
        bottom: `100%`,
        animationDuration: dur,
        animationDelay: `-${(Math.random() * parseFloat(dur)).toFixed(2)}s`,
        animationFillMode: "both",
      });

      let txt = "";
      for (let r = 0; r < totalRows; r++) {
        txt += (Math.random() < 0.5 ? "0" : "1") + "<br>";
      }
      colDiv.innerHTML = txt;
      container.appendChild(colDiv);
    }
  }

  function stopRobotThinkingAnimation() {
    if (!thinkingOverlay) return;
    thinkingOverlay.classList.remove("visible");
    setTimeout(() => {
      if (!thinkingOverlay) return;
      thinkingOverlay.innerHTML = "";
      thinkingOverlay = null;
    }, 1000);
  }

  // ==========================================================
  // 7) CONFIGURACIÓN DE DIFICULTAD + BADGE
  // ==========================================================
  let difficultyLevel = 1;
  const robotBadge = document.getElementById("robotDifficulty");

  function updateRobotDifficultyBadge(level) {
    robotBadge.textContent = `Nivel ${level}`;
  }
  updateRobotDifficultyBadge(difficultyLevel);

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

  function getCastlingRights() {
    let rights = "";

    // Blancas
    if (!kingMoved.w) {
      if (!rookMoved.w.right) rights += "K";
      if (!rookMoved.w.left) rights += "Q";
    }

    // Negras
    if (!kingMoved.b) {
      if (!rookMoved.b.right) rights += "k";
      if (!rookMoved.b.left) rights += "q";
    }

    return rights || "-";
  }

  function boardToFEN() {
    let fen = "";
    for (let i = 0; i < 8; i++) {
      let empty = 0;
      for (let j = 0; j < 8; j++) {
        const cell = board[i][j];
        if (!cell) empty++;
        else {
          if (empty > 0) {
            fen += empty;
            empty = 0;
          }
          fen +=
            cell[0] === "w" ? cell[1].toUpperCase() : cell[1].toLowerCase();
        }
      }
      if (empty > 0) fen += empty;
      if (i < 7) fen += "/";
    }

    const side = currentTurn === "w" ? "w" : "b";
    const castling = getCastlingRights();

    // enPassantTarget opcional (de momento lo dejamos “-”)
    fen += ` ${side} ${castling} - 0 1`;
    return fen;
  }

  const repetitionCount = new Map();

  function repetitionKey() {
    // piezas + turno + enroques + en-passant (si lo implementas)
    // IMPORTANTE: sin contadores de movimientos
    let s = "";
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        s += board[r][c] ? board[r][c] : "0";
        s += ",";
      }
    }
    const turn = currentTurn;
    const castling = getCastlingRights ? getCastlingRights() : "KQkq"; // si ya lo arreglaste
    const ep = enPassantTarget
      ? `ep:${enPassantTarget.row}${enPassantTarget.col}`
      : "ep:-";
    return `${s}|t:${turn}|c:${castling}|${ep}`;
  }

  // ==========================================================
  // 8) MÚSICA Y SONIDOS
  // ==========================================================
  const menuMusic = new Audio("assets/sounds/music-1.mp3");
  menuMusic.loop = true;
  menuMusic.volume = 0.6;
  menuMusic.play().catch(() => {});

  const gameMusic = new Audio();
  gameMusic.loop = true;
  gameMusic.volume = 0.6;

  const playlist = ["assets/sounds/music-2.mp3"];
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

  const btnPrevTrack = document.getElementById("prevTrack");
  const btnNextTrack = document.getElementById("nextTrack");
  const btnToggleMute = document.getElementById("toggleMute");

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

  const countdownSound = new Audio("assets/sounds/sound-cowntdown.mp3");
  countdownSound.loop = true;
  countdownSound.volume = 0.7;

  const soundVolumes = {
    move: 0.7,
    capture: 0.6,
    check: 0.6,
    checkmate: 0.6,
    promotion: 0.6,
    select: 0.8,
    error: 0.7,
  };

  function setSoundVolume(name, value) {
    if (soundVolumes[name] == null) return;
    soundVolumes[name] = Math.max(0, Math.min(1, value));
  }

  const audioPools = new Map();

  function playSound(audioObj, type) {
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

  const buttonSound = new Audio("assets/sounds/sound-select(2).mp3");
  const selectSound = new Audio("assets/sounds/sound-select(1).mp3");
  const checkSound = new Audio("assets/sounds/sound-check.wav");
  const checkmateSound = new Audio("assets/sounds/sound-checkmate.wav");
  const moveSound = new Audio("assets/sounds/sound-move(8).mp3");
  const captureSound = new Audio("assets/sounds/sound-capture(4).mp3");
  const errorSound = new Audio("assets/sounds/sound-error(3).mp3");
  const promotionSound = new Audio("assets/sounds/sound-recharged(5).mp3");

  // ==========================================================
  // 9) MENÚ DESPLEGABLE DEL HEADER
  // ==========================================================
  document.getElementById("menuButton")?.addEventListener("pointerup", () => {
    document.getElementById("dropdownMenu").classList.toggle("show");
  });

  document.querySelector(".menu-close")?.addEventListener("pointerup", () => {
    document.getElementById("dropdownMenu").classList.remove("show");
  });

  // ==========================================================
  // 10) HELPERS GENERALES (addEventMulti, estilos, sonido botones)
  // ==========================================================
  function addEventMulti(el, events, handler) {
    events.forEach((evt) => el.addEventListener(evt, handler, false));
  }

  document.querySelectorAll("button").forEach((btn) => {
    if (btn.id !== "btnPrev" && btn.id !== "btnNext") {
      addEventMulti(btn, ["pointerup"], () => playSound(buttonSound, "select"));
    }
  });

  document.documentElement.style.setProperty(
    "--cycle-border-color",
    "rgb(79, 246, 255)"
  );

  // ==========================================================
  // 11) VARIABLES GLOBALES Y SELECTORES DOM
  // ==========================================================
  const chessContainer = document.querySelector(".chess-container");
  const timeConfigBtn = document.getElementById("timeConfigButton");
  const playButton = document.getElementById("playButton");
  const chessBoard = document.getElementById("chessBoard");

  const player1TimerEl = document.querySelector("#player1 .player-timer");
  const player2TimerEl = document.querySelector("#player2 .player-timer");
  const player1ScoreEl = document.querySelector("#player1 .player-score");
  const player2ScoreEl = document.querySelector("#player2 .player-score");

  const navPrevBtn = document.getElementById("btnPrev");
  const navNextBtn = document.getElementById("btnNext");
  const btnSurrender = document.getElementById("btnSurrender");
  btnSurrender?.addEventListener("pointerup", (e) => {
    e.preventDefault();
    showResignConfirmModal();
  });

  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  const historyContainer = document.getElementById("moveHistory");
  const SCROLL_STEP = 100;

  let board = [];
  let selectedCell = null;
  let lastMoveCells = [];

  let currentTurn = "w";
  let timerIntervals = {};
  let timers = {};

  let scores = { w: 0, b: 0 };
  let selectedTime = null;

  let positionHistory = [];
  let currentHistoryIndex = 0;
  let isReviewMode = false;

  let kingMoved = { w: false, b: false };
  let rookMoved = {
    w: { left: false, right: false },
    b: { left: false, right: false },
  };

  const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const kingBaseHealth = 5;
  let maxHealth = { w: 39 + kingBaseHealth, b: 39 + kingBaseHealth };
  let currentHealth = { ...maxHealth };
  let enPassantTarget = null;
  let lastTick = { w: 0, b: 0 };

  let isAnimating = false;
  let isNavigating = false;
  let hasGameStartedFromMenu = false;

  const pieceImages = {
    wk: "assets/images/pink-neon-king.png",
    wq: "assets/images/pink-neon-queen.png",
    wr: "assets/images/pink-neon-rook.png",
    wb: "assets/images/pink-neon-bishop.png",
    wn: "assets/images/pink-neon-horse.png",
    wp: "assets/images/pink-neon-pawn.png",
    bk: "assets/images/blue-neon-king.png",
    bq: "assets/images/blue-neon-queen.png",
    br: "assets/images/blue-neon-rook.png",
    bb: "assets/images/blue-neon-bishop.png",
    bn: "assets/images/blue-neon-horse.png",
    bp: "assets/images/blue-neon-pawn.png",
  };

  let humanColor = "w"; // color elegido por el humano

  // ==========================================================
  // 12) HISTORIAL DE POSICIONES (snapshots, insuficiencia material)
  // ==========================================================
  function getBoardPosition() {
    let pos = "";
    board.forEach((row) =>
      row.forEach((cell) => {
        pos += cell ? cell : "0";
        pos += ",";
      })
    );
    pos += "_" + currentTurn;
    return pos;
  }

  function getBoardPositionSnapshot() {
    return board.map((row) => row.slice());
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

    // Solo reyes
    if (pieces.w.length === 0 && pieces.b.length === 0) return true;

    // Rey + (alfil o caballo) vs rey
    const minorOnly = (arr) =>
      arr.length === 1 && (arr[0].type === "b" || arr[0].type === "n");

    if (pieces.w.length === 0 && minorOnly(pieces.b)) return true;
    if (pieces.b.length === 0 && minorOnly(pieces.w)) return true;

    // Rey + alfil vs Rey + alfil (solo si ambos tienen un único alfil)
    const oneBishopOnly = (arr) => arr.length === 1 && arr[0].type === "b";
    if (oneBishopOnly(pieces.w) && oneBishopOnly(pieces.b)) {
      // color de casilla: (r+c)%2
      const wColor = (pieces.w[0].r + pieces.w[0].c) % 2;
      const bColor = (pieces.b[0].r + pieces.b[0].c) % 2;
      if (wColor === bColor) return true; // mismo color => tablas
    }

    return false;
  }

  function updatePositionHistory(lastMoveByExplicit) {
    const pos = getBoardPosition();

    if (currentHistoryIndex < positionHistory.length - 1) {
      positionHistory.splice(currentHistoryIndex + 1);
    }

    const lastEntry = positionHistory[positionHistory.length - 1];
    const forcedLastMoveBy =
      positionHistory.length === 0 ? "b" : lastMoveByExplicit ?? currentTurn;

    if (!lastEntry || lastEntry.pos !== pos) {
      positionHistory.push({
        pos,
        lastMoveBy: forcedLastMoveBy,
        health: { w: currentHealth.w, b: currentHealth.b },
        scores: { w: scores.w, b: scores.b },
        castling: {
          kingMoved: { ...kingMoved },
          rookMoved: {
            w: { ...rookMoved.w },
            b: { ...rookMoved.b },
          },
        },
      });
      currentHistoryIndex = positionHistory.length - 1;
      return false;
    }

    return isInsufficientMaterial();
  }

  function syncHistoryFromSnapshot(idx) {
    const snapshot = positionHistory[idx];
    const [boardStr] = snapshot.pos.split("_");
    const cells = boardStr.split(",");

    board = [];
    for (let i = 0; i < 8; i++) {
      const row = [];
      for (let j = 0; j < 8; j++) {
        row.push(cells[i * 8 + j] === "0" ? null : cells[i * 8 + j]);
      }
      board.push(row);
    }

    currentTurn = snapshot.lastMoveBy === "w" ? "b" : "w";
    currentHealth.w = snapshot.health.w;
    currentHealth.b = snapshot.health.b;
    updateHealthBar();

    scores.w = snapshot.scores.w;
    scores.b = snapshot.scores.b;
    updateScores();

    kingMoved = { ...snapshot.castling.kingMoved };
    rookMoved = {
      w: { ...snapshot.castling.rookMoved.w },
      b: { ...snapshot.castling.rookMoved.b },
    };
  }

  // ==========================================================
  // 13) BARRA DE SALUD
  // ==========================================================
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
    const barWhite = document.getElementById("health-white");
    const barBlack = document.getElementById("health-black");
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

  // ==========================================================
  // 14) MARCADORES DE MOVIMIENTO + RESALTADO ÚLTIMO MOVIMIENTO
  // ==========================================================
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

  function removeMoveIndicators() {
    document.querySelectorAll(".move-indicator").forEach((m) => m.remove());
  }

  function removeLastMoveHighlights() {
    document
      .querySelectorAll(".cell")
      .forEach((cell) => cell.classList.remove("highlight"));
    lastMoveCells = [];
  }

  // ==========================================================
  // 15) GENERACIÓN Y RENDERIZADO DEL TABLERO
  // ==========================================================
  function setupInitialBoard() {
    const boardEl = document.getElementById("chessBoard");

    // Flip según color humano
    boardEl.classList.toggle("flipped", humanColor === "b");

    // Genera 64 celdas (y reinicia board)
    generateEmptyBoard();

    // Ahora sí: pinta coordenadas sobre celdas ya existentes
    renderCoordinates();

    // Coloca piezas iniciales en board[][]
    board[0] = ["br", "bn", "bb", "bq", "bk", "bb", "bn", "br"];
    board[1] = Array(8).fill("bp");
    board[6] = Array(8).fill("wp");
    board[7] = ["wr", "wn", "wb", "wq", "wk", "wb", "wn", "wr"];

    enPassantTarget = null;
    positionHistory = [];
    currentHistoryIndex = 0;
    isReviewMode = false;

    renderBoard();
    updatePositionHistory();
  }

  function generateEmptyBoard() {
    const boardEl = document.getElementById("chessBoard");
    boardEl.innerHTML = "";
    board = [];

    for (let row = 0; row < 8; row++) {
      const rowArr = [];
      for (let col = 0; col < 8; col++) {
        const cell = document.createElement("div");
        const baseLight = (row + col) % 2 === 0;
        const isLight = baseLight;

        cell.className = `cell ${isLight ? "light" : "dark"}`;
        cell.dataset.row = row;
        cell.dataset.col = col;
        cell.addEventListener("pointerup", onCellClick);
        boardEl.appendChild(cell);
        rowArr.push(null);
      }
      board.push(rowArr);
    }
  }

  function renderBoard() {
    const boardEl = document.getElementById("chessBoard");
    const isFlipped = boardEl.classList.contains("flipped");

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const physRow = isFlipped ? 7 - row : row;
        const physCol = isFlipped ? 7 - col : col;
        const idx = physRow * 8 + physCol;
        const cell = boardEl.children[idx];

        const code = board[row][col];
        let img = cell.querySelector("img.piece");

        if (code) {
          if (!img) {
            img = document.createElement("img");
            img.className = "piece";
            Object.assign(img.style, {
              width: "85%",
              height: "auto",
              display: "block",
              margin: "0 auto",
              position: "relative",
              zIndex: 2,
              willChange: "transform",
              backfaceVisibility: "hidden",
            });
          }

          if (img.dataset.code !== code) {
            img.src = pieceImages[code];
            img.alt = code;
            img.dataset.code = code;
          }

          if (!img.isConnected) {
            img.addEventListener("pointerdown", onPointerDown);
            cell.appendChild(img);
          }
        } else if (img) {
          img.remove();
        }
      }
    }
  }

  function getCell(row, col) {
    const boardEl = document.getElementById("chessBoard");
    const isFlipped = boardEl.classList.contains("flipped");
    const physRow = isFlipped ? 7 - row : row;
    const physCol = isFlipped ? 7 - col : col;
    const idx = physRow * 8 + physCol;
    return boardEl.children[idx];
  }

  function showLegalMoves(from) {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (isValidMove(from, { row: i, col: j })) {
          insertMarker(getCell(i, j));
        }
      }
    }
    const p = board[from.row][from.col];
    if (p && p[1] === "k") {
      const row = from.row;
      if (isValidMove(from, { row, col: from.col + 2 })) {
        insertMarker(getCell(row, from.col + 1));
      }
      if (isValidMove(from, { row, col: from.col - 2 })) {
        insertMarker(getCell(row, from.col - 1));
      }
    }
  }

  function renderCoordinates() {
    const boardEl = document.getElementById("chessBoard");
    if (!boardEl) return;

    const isFlipped = boardEl.classList.contains("flipped");

    // borrar coords previas
    boardEl.querySelectorAll(".coord-label").forEach((n) => n.remove());

    const files = "abcdefgh";

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = boardEl.children[r * 8 + c];
        if (!cell) continue;

        // asegura stacking correcto
        cell.style.position = "relative";

        const rank = isFlipped ? 1 + r : 8 - r;
        const file = isFlipped ? files[7 - c] : files[c];

        if (c === 0) {
          const lab = document.createElement("div");
          lab.className = "coord-label row";
          lab.textContent = rank;

          // inline para que NADA lo oculte
          lab.style.cssText = `
          position:absolute; top:3px; left:3px;
          font-family:FrancoisOne, sans-serif;
          font-size:12px; line-height:12px;
          color:rgb(17,255,255);
          text-shadow:0 0 10px rgb(17,255,255);
          z-index:999999;
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
          color:rgb(17,255,255);
          text-shadow:0 0 10px rgb(17,255,255);
          z-index:999999;
          pointer-events:none;
          user-select:none;
        `;
          cell.appendChild(lab);
        }
      }
    }
  }

  // ==========================================================
  // 16) ANIMACIONES DE AMENAZA AL REY
  // ==========================================================
  function getLinePath(fromPos, toPos) {
    const path = [];
    const dr = Math.sign(toPos.row - fromPos.row);
    const dc = Math.sign(toPos.col - fromPos.col);
    let r = fromPos.row;
    let c = fromPos.col;

    while (true) {
      path.push({ row: r, col: c });
      if (r === toPos.row && c === toPos.col) break;
      r += dr;
      c += dc;
    }
    return path;
  }

  function animateThreatPath(path) {
    path.forEach((pos) => {
      const cell = getCell(pos.row, pos.col);
      cell.classList.add("threat-highlight");
    });
    setTimeout(() => {
      path.forEach((pos) => {
        const cell = getCell(pos.row, pos.col);
        cell.classList.remove("threat-highlight");
      });
    }, 300);
  }

  function showKingThreatAnimation(square) {
    const opp = currentTurn === "w" ? "b" : "w";
    const attackers = [];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (
          board[r][c] &&
          board[r][c][0] === opp &&
          canAttack({ row: r, col: c }, square)
        ) {
          attackers.push({ row: r, col: c });
        }
      }
    }

    attackers.forEach(({ row, col }) => {
      const cell = getCell(row, col);
      if (cell) cell.classList.add("threat-highlight");
    });

    const targetCell = getCell(square.row, square.col);
    if (targetCell) targetCell.classList.add("threat-highlight");

    setTimeout(() => {
      attackers.forEach(({ row, col }) => {
        const cell = getCell(row, col);
        if (cell) cell.classList.remove("threat-highlight");
      });
      if (targetCell) targetCell.classList.remove("threat-highlight");
    }, 1000);
  }

  function animateKnightThreatPath(path) {
    path.forEach((pos, idx) => {
      setTimeout(() => {
        const cell = getCell(pos.row, pos.col);
        if (!cell) return;
        cell.classList.add("threat-highlight");
        setTimeout(() => {
          cell.classList.remove("threat-highlight");
        }, 400);
      }, idx * 400);
    });
  }

  // ==========================================================
  // 17) REGLAS DE MOVIMIENTO Y ATAQUES
  // ==========================================================
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

  function isSquareAttacked(pos, color) {
    const opp = color === "w" ? "b" : "w";
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const p = board[i][j];
        if (p && p[0] === opp && canAttack({ row: i, col: j }, pos))
          return true;
      }
    }
    return false;
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
      case "p":
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
          if (
            dRow === -1 &&
            Math.abs(dCol) === 1 &&
            target &&
            target[0] === "b"
          )
            return !moveLeavesKingInCheck(from, to, color);
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
        if (dRow === 0 || dCol === 0 || Math.abs(dRow) === Math.abs(dCol))
          return (
            isPathClear(from, to) && !moveLeavesKingInCheck(from, to, color)
          );
        return false;

      case "k":
        // Enroque
        if (from.col === 4 && Math.abs(dCol) === 2 && dRow === 0) {
          if (kingMoved[color]) return false;
          const row = from.row;

          if (dCol > 0) {
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

      default:
        return false;
    }
  }

  function isKingInCheck(color) {
    let kingPos = null;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (board[i][j] === color + "k") {
          kingPos = { row: i, col: j };
          break;
        }
      }
      if (kingPos) break;
    }
    return kingPos ? isSquareAttacked(kingPos, color) : false;
  }

  function isCheckmate(color) {
    if (!isKingInCheck(color)) return false;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (board[i][j] && board[i][j][0] === color) {
          for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
              if (isValidMove({ row: i, col: j }, { row: r, col: c }))
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
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (board[i][j] && board[i][j][0] === color) {
          for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
              if (isValidMove({ row: i, col: j }, { row: r, col: c }))
                return false;
            }
          }
        }
      }
    }
    return true;
  }

  // ==========================================================
  // 18) MOVER PIEZA (animado) + CAPTURAS + PROMOCIÓN
  // ==========================================================
  function animatePieceMove(pieceElem, fromCell, toCell, callback) {
    const pieceRect = pieceElem.getBoundingClientRect();
    const fromRect = fromCell.getBoundingClientRect();
    const toRect = toCell.getBoundingClientRect();

    const w = pieceRect.width;
    const h = pieceRect.height;

    const toLeft = toRect.left + (toRect.width - w) / 2;
    const toTop = toRect.top + (toRect.height - h) / 2;
    const dx = toLeft - pieceRect.left;
    const dy = toTop - pieceRect.top;

    const clone = pieceElem.cloneNode(true);
    Object.assign(clone.style, {
      position: "absolute",
      left: `${pieceRect.left}px`,
      top: `${pieceRect.top}px`,
      width: `${w}px`,
      height: `${h}px`,
      margin: 0,
      pointerEvents: "none",
      zIndex: 1000,
      willChange: "transform",
      backfaceVisibility: "hidden",
      transform: "translateZ(0)",
    });
    document.body.appendChild(clone);

    pieceElem.style.visibility = "hidden";

    clone.animate(
      [
        { transform: "translate(0, 0)" },
        { transform: `translate(${dx}px, ${dy}px)` },
      ],
      {
        duration: 100,
        easing: "ease-in-out",
        fill: "forwards",
      }
    ).onfinish = () => {
      clone.remove();
      pieceElem.style.visibility = "visible";
      if (typeof callback === "function") callback();
    };
  }

  function movePiece(from, to, isHumanMove = false) {
    isReviewMode = false;

    removeLastMoveHighlights();
    getCell(from.row, from.col).classList.add("highlight");
    getCell(to.row, to.col).classList.add("highlight");
    lastMoveCells = [
      { row: from.row, col: from.col },
      { row: to.row, col: to.col },
    ];

    if (isAnimating) return;
    isAnimating = true;

    const piece = board[from.row][from.col];
    if (piece[1] === "k") kingMoved[currentTurn] = true;

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
      updateScores();

      const victim = target[0];
      currentHealth[victim] = Math.max(
        kingBaseHealth,
        currentHealth[victim] - captureValue
      );
      updateHealthBar();
    }

    board[to.row][to.col] = piece;
    board[from.row][from.col] = null;
    if (enPassantCapture) {
      board[from.row][to.col] = null;
    }

    if (piece[1] === "p") {
      if (piece[0] === "w" && from.row === 6 && to.row === 4) {
        enPassantTarget = { row: 5, col: from.col };
      } else if (piece[0] === "b" && from.row === 1 && to.row === 3) {
        enPassantTarget = { row: 2, col: from.col };
      } else {
        enPassantTarget = null;
      }
    } else {
      enPassantTarget = null;
    }

    // ---- Enroque (castling) ----
    const isCastling = piece[1] === "k" && Math.abs(to.col - from.col) === 2;
    if (isCastling) {
      const row = from.row;
      const rookFromCol = to.col === 6 ? 7 : 0;
      const rookToCol = to.col === 6 ? 5 : 3;

      board[row][rookToCol] = board[row][rookFromCol];
      board[row][rookFromCol] = null;

      const kFromCell = getCell(from.row, from.col);
      const kToCell = getCell(to.row, to.col);
      const rFromCell = getCell(row, rookFromCol);
      const rToCell = getCell(row, rookToCol);

      const kImg = kFromCell.querySelector("img");
      const rImg = rFromCell.querySelector("img");

      kingMoved[currentTurn] = true;
      if (to.col === 6) rookMoved[currentTurn].right = true;
      else rookMoved[currentTurn].left = true;

      playSound(moveSound, "move");
      setTimeout(() => playSound(moveSound, "move"), 100);

      let doneCount = 0;
      function onDone() {
        if (++doneCount < 2) return;

        const files = "abcdefgh";
        const kingTo = files[to.col] + (8 - to.row);
        logMove({ color: currentTurn, type: "k" }, kingTo);

        removeLastMoveHighlights();
        getCell(from.row, from.col).classList.add("highlight");
        getCell(to.row, to.col).classList.add("highlight");
        const rookFromCol = to.col === 6 ? 7 : 0;
        const rookToCol = to.col === 6 ? 5 : 3;
        getCell(row, rookFromCol).classList.add("highlight");
        getCell(row, rookToCol).classList.add("highlight");
        lastMoveCells = [
          { row: from.row, col: from.col },
          { row: to.row, col: to.col },
          { row, col: rookFromCol },
          { row, col: rookToCol },
        ];

        renderBoard();

        if (isHumanMove && isOnlineGame && currentRoomId) {
          emitOnlineMove(from, to);
        }

        finishMove();
        isAnimating = false;
      }

      animatePieceMove(kImg, kFromCell, kToCell, onDone);
      animatePieceMove(rImg, rFromCell, rToCell, onDone);
      return;
    }

    try {
      if (isCapture) {
        createCapturedPieceExplosion(target, to);
        playSound(captureSound, "capture");
      } else {
        playSound(moveSound, "move");
      }
    } catch (err) {
      console.error("[CAPTURE] error:", err);
    }

    const fromCellElem = getCell(from.row, from.col);
    const movingPieceElem = fromCellElem.querySelector("img");
    const toCellElem = getCell(to.row, to.col);

    // ✅ Si por lo que sea no existe la imagen, no animamos (pero la partida sigue)
    if (!movingPieceElem || !fromCellElem || !toCellElem) {
      renderBoard();
      finishMove();
      isAnimating = false;
      return;
    }

    animatePieceMove(movingPieceElem, fromCellElem, toCellElem, () => {
      const isPromotion =
        piece[1] === "p" &&
        ((piece[0] === "w" && to.row === 0) ||
          (piece[0] === "b" && to.row === 7));

      if (isPromotion) {
        showPromotionModal(piece[0], to.row, to.col, (promoted) => {
          board[to.row][to.col] = promoted;
          playSound(promotionSound, "promotion");
          renderBoard();
          updateHealthBar();
          updatePositionHistory();

          if (isHumanMove) emitOnlineMove(from, to);

          const val = pieceValues[promoted[1]];
          currentHealth[promoted[0]] = Math.min(
            maxHealth[promoted[0]],
            currentHealth[promoted[0]] + val
          );
          updateHealthBar();
          finishMove();
          isAnimating = false;
        });
      } else {
        renderBoard();

        const files = "abcdefgh";
        const toAlg = files[to.col] + (8 - to.row);
        logMove({ color: piece[0], type: piece[1] }, toAlg);

        if (isHumanMove) emitOnlineMove(from, to);

        getCell(from.row, from.col).classList.add("highlight");
        getCell(to.row, to.col).classList.add("highlight");
        lastMoveCells = [
          { row: from.row, col: from.col },
          { row: to.row, col: to.col },
        ];

        finishMove();
        isAnimating = false;
      }
    });
  }

  function simulateMove(from, to, fnCheck) {
    const a = { ...from };
    const b = { ...to };
    const origFrom = board[a.row][a.col];
    const origTo = board[b.row][b.col];

    board[b.row][b.col] = origFrom;
    board[a.row][a.col] = null;

    let ok;
    try {
      ok = fnCheck();
    } finally {
      board[a.row][a.col] = origFrom;
      board[b.row][b.col] = origTo;
    }
    return ok;
  }

  function movePieceNoAnim(from, to, isHumanMove = false) {
    isReviewMode = false;

    const piece = board[from.row][from.col];
    if (piece[1] === "k") kingMoved[currentTurn] = true;

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
      updateScores();

      const victim = target[0];
      currentHealth[victim] = Math.max(
        kingBaseHealth,
        currentHealth[victim] - captureValue
      );
      updateHealthBar();
    }

    board[to.row][to.col] = piece;
    board[from.row][from.col] = null;
    if (enPassantCapture) {
      board[from.row][to.col] = null;
      isCapture = true;
    }

    if (piece[1] === "p") {
      if (piece[0] === "w" && from.row === 6 && to.row === 4) {
        enPassantTarget = { row: 5, col: from.col };
      } else if (piece[0] === "b" && from.row === 1 && to.row === 3) {
        enPassantTarget = { row: 2, col: from.col };
      } else {
        enPassantTarget = null;
      }
    } else {
      enPassantTarget = null;
    }

    if (isCapture) {
      playSound(captureSound, "capture");
      createCapturedPieceExplosion(target, to);
    } else {
      playSound(moveSound, "move");
    }

    const isPromotion =
      piece[1] === "p" &&
      ((piece[0] === "w" && to.row === 0) ||
        (piece[0] === "b" && to.row === 7));

    if (isPromotion) {
      showPromotionModal(piece[0], to.row, to.col, function (promoted) {
        board[to.row][to.col] = promoted;
        playSound(promotionSound, "promotion");
        renderBoard();

        const files = "abcdefgh";
        const toAlg = files[to.col] + (8 - to.row);
        logMove({ color: piece[0], type: piece[1] }, toAlg);

        const valor = pieceValues[promoted[1]];
        currentHealth[promoted[0]] = Math.min(
          maxHealth[promoted[0]],
          currentHealth[promoted[0]] + valor
        );
        updateHealthBar();

        if (isHumanMove && isOnlineGame && currentRoomId) {
          socket.emit("playerMove", {
            roomId: currentRoomId,
            move: { from, to },
          });
        }

        finishMove();
      });
      return;
    }

    removeLastMoveHighlights();
    renderBoard();
    getCell(from.row, from.col).classList.add("highlight");
    getCell(to.row, to.col).classList.add("highlight");
    lastMoveCells = [
      { row: from.row, col: from.col },
      { row: to.row, col: to.col },
    ];

    if (isHumanMove) emitOnlineMove(from, to);

    finishMove();
  }

  // ==========================================================
  // 19) MANEJO DE CLICK EN CELDA
  // ==========================================================
  function getLogicalPos(cell) {
    let row = parseInt(cell.dataset.row, 10);
    let col = parseInt(cell.dataset.col, 10);
    const isFlipped = document
      .getElementById("chessBoard")
      .classList.contains("flipped");

    if (isFlipped) {
      row = 7 - row;
      col = 7 - col;
    }
    return { row, col };
  }

  function onCellClick(e) {
    if (isDragging) {
      isDragging = false;
      return;
    }
    e.preventDefault();

    if (currentTurn !== humanColor) return;

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

    if (board[row][col] && board[row][col][0] === currentTurn) {
      getCell(selectedCell.row, selectedCell.col).classList.remove("selected");
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

    if (piece && piece[1] === "k") {
      const dRow = Math.abs(targetPos.row - from.row);
      const dCol = Math.abs(targetPos.col - from.col);
      if (dRow <= 1 && dCol <= 1) {
        const attacked = simulateMove(from, targetPos, () =>
          isSquareAttacked(targetPos, currentTurn)
        );
        if (attacked) {
          playSound(errorSound, "error");
          showKingThreatAnimation(targetPos);
          getCell(from.row, from.col).classList.remove("selected");
          selectedCell = null;
          return;
        }
      }
    } else if (piece && moveLeavesKingInCheck(from, targetPos, currentTurn)) {
      playSound(errorSound, "error");
      const kingPos = findKingPosition(currentTurn);
      if (kingPos) {
        const blocker = board[from.row][from.col];
        board[from.row][from.col] = null;
        showKingThreatAnimation(kingPos);
        board[from.row][from.col] = blocker;
      } else {
        blinkCell(cell);
      }
      getCell(from.row, from.col).classList.remove("selected");
      selectedCell = null;
      return;
    }

    if (isValidMove(from, targetPos)) {
      getCell(from.row, from.col).classList.remove("selected");
      movePiece(from, targetPos, true);
    } else {
      blinkCell(cell);
      getCell(from.row, from.col).classList.remove("selected");
    }

    selectedCell = null;
  }

  // ==========================================================
  // 20) DRAG & DROP MEJORADO
  // ==========================================================
  let dragClone = null;
  let dragOrigin = null;
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let dragOffset = { x: 0, y: 0 };
  const DRAG_THRESHOLD = 5;

  function onPointerDown(e) {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    if (currentTurn !== humanColor) return;
    const { row, col } = getLogicalPos(cell);
    if (!board[row][col] || board[row][col][0] !== humanColor) return;

    e.preventDefault();
    dragOrigin = { row, col };
    dragStart = { x: e.clientX, y: e.clientY };
    isDragging = false;

    const img = cell.querySelector("img");
    img.setPointerCapture(e.pointerId);
    img.addEventListener("pointermove", onPointerMove);
    img.addEventListener("pointerup", onPointerUp);
    img.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(e) {
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;

    if (!isDragging) {
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        isDragging = true;
        playSound(selectSound, "select");
        removeLastMoveHighlights();
        removeMoveIndicators();

        const origImg = e.currentTarget;
        const rect = origImg.getBoundingClientRect();
        dragOffset = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
        dragClone = origImg.cloneNode(true);
        Object.assign(dragClone.style, {
          position: "fixed",
          left: `${e.clientX - dragOffset.x}px`,
          top: `${e.clientY - dragOffset.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: 0,
          pointerEvents: "none",
          zIndex: 1000,
        });
        document.body.appendChild(dragClone);
        origImg.style.visibility = "hidden";
        showLegalMoves(dragOrigin);
      } else {
        return;
      }
    }

    dragClone.style.left = `${e.clientX - dragOffset.x}px`;
    dragClone.style.top = `${e.clientY - dragOffset.y}px`;
  }

  function onPointerUp(e) {
    const img = e.currentTarget;
    img.releasePointerCapture?.(e.pointerId);
    img.removeEventListener("pointermove", onPointerMove);
    img.removeEventListener("pointerup", onPointerUp);
    img.removeEventListener("pointercancel", onPointerUp);

    if (isDragging) {
      const dropEl = document.elementFromPoint(e.clientX, e.clientY);
      const dropCell = dropEl ? dropEl.closest(".cell") : null;

      const originCell = getCell(dragOrigin.row, dragOrigin.col);
      const origImg = originCell ? originCell.querySelector("img") : null;
      if (origImg) origImg.style.visibility = "visible";

      if (dropCell) {
        const to = getLogicalPos(dropCell);
        const piece = board?.[dragOrigin.row]?.[dragOrigin.col];

        if (piece && isValidMove(dragOrigin, to)) {
          movePieceNoAnim(dragOrigin, to, true);
        } else {
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

  document.addEventListener("pointerup", (e) => {
    if (isDragging && dragClone) onPointerUp.call(dragClone, e);
  });

  // ==========================================================
  // 21) EFECTOS VISUALES (explosión, check, checkmate)
  // ==========================================================
  function createCapturedPieceExplosion(capturedCode, to) {
    const src = pieceImages[capturedCode];
    if (!src) return; // ✅ si no hay imagen, no hacemos nada

    const count = 15;
    const cell = getCell(to.row, to.col);
    if (!cell) return;

    const rect = cell.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;
    const size = rect.width;
    const DISTANCE = rect.width * 1.6;

    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count;
      const dx = Math.cos(angle) * DISTANCE;
      const dy = Math.sin(angle) * DISTANCE;

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
        transform: "translate(-50%, -50%) scale(1)",
        opacity: "1",
        zIndex: "1000",
      });

      document.body.appendChild(img);

      img.animate(
        [
          {
            transform: "translate(-50%, -50%) translate(0, 0) scale(1)",
            opacity: 1,
          },
          {
            transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(1.5)`,
            opacity: 0,
          },
        ],
        { duration: 400, easing: "ease-out", fill: "forwards" }
      ).onfinish = () => img.remove();
    }
  }

  function showCheckAnimation() {
    const anim = document.createElement("div");
    anim.classList.add("check-animation");
    anim.textContent = "CHECK!";
    const boardRect = document
      .getElementById("chessBoard")
      .getBoundingClientRect();
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
    const boardRect = document
      .getElementById("chessBoard")
      .getBoundingClientRect();
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

  // ==========================================================
  // 22) FINALIZAR MOVIMIENTO Y MODALES DE PARTIDA
  // ==========================================================
  function showPromotionModal(color, row, col, callback) {
    const overlay = document.createElement("div");
    overlay.id = "promotionModal";

    const content = document.createElement("div");
    content.classList.add("modal-content", "styled-modal");

    const title = document.createElement("h2");
    title.textContent = "Transforma tu pieza";
    content.appendChild(title);

    const opts = document.createElement("div");
    opts.classList.add("promotion-options");

    ["r", "n", "b", "q"].forEach((type) => {
      const img = document.createElement("img");
      const key = color + type;
      img.src = pieceImages[key];
      img.alt = key;
      addEventMulti(img, ["pointerup"], function () {
        playSound(promotionSound, "promotion");
        callback(key);
        overlay.remove();
      });
      opts.appendChild(img);
    });

    content.appendChild(opts);
    overlay.appendChild(content);
    document.body.appendChild(overlay);
  }

  function showEndGameModal(message) {
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

    const winnerIsHuman = message.toLowerCase().includes("humano");
    const winnerId = winnerIsHuman ? "player2" : "player1";

    const profileImg = document
      .getElementById(winnerId)
      ?.querySelector(".profile-image img");

    if (profileImg) {
      const img = document.createElement("img");
      img.src = profileImg.src;
      img.alt = profileImg.alt || `Avatar ${winnerId}`;
      img.classList.add("modal-winner-avatar");
      content.appendChild(img);
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
    volver.addEventListener("pointerup", () => window.location.reload());

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

      const winner =
        humanColor === "w"
          ? "Azules ganan por rendición."
          : "Rosas ganan por rendición.";

      if (isOnlineGame && currentRoomId) {
        ensureSocket()?.emit("resign", { roomId: currentRoomId });
      }

      stopTimer("w");
      stopTimer("b");
      showEndGameModal(winner);
    });

    btns.append(cancel, confirm);
    content.appendChild(btns);

    overlay.appendChild(content);
    document.body.appendChild(overlay);
  }

  function finishMove() {
    updateKingStatus();
    const opp = currentTurn === "w" ? "b" : "w";

    // 1) Jaque / mate
    if (isKingInCheck(opp) && isCheckmate(opp)) {
      currentHealth[opp] = 0;
      updateHealthBar();
      playSound(checkmateSound, "checkmate");
      showCheckmateAnimation();
      setTimeout(() => {
        showEndGameModal(
          (currentTurn === "w" ? "Jugador humano" : "GPR robot") +
            " gana por jaque mate"
        );
      }, 1200);
      return;
    }

    if (isKingInCheck(opp)) {
      showCheckAnimation();
      playSound(checkSound, "check");
    }

    // 2) Tablas: stalemate
    if (!isKingInCheck(opp) && isStalemate(opp)) {
      stopTimer(currentTurn);
      showEndGameModal("Tablas por rey ahogado");
      return;
    }

    // 3) Tablas: insuficiencia de material
    if (isInsufficientMaterial()) {
      stopTimer(currentTurn);
      showEndGameModal("Tablas por insuficiencia de material");
      return;
    }

    // 4) Guardar snapshot UNA sola vez
    updatePositionHistory();

    const key = repetitionKey();
    repetitionCount.set(key, (repetitionCount.get(key) || 0) + 1);

    if (repetitionCount.get(key) >= 3) {
      stopTimer(currentTurn);
      showEndGameModal("Tablas por triple repetición");
      return;
    }

    // 5) Cambiar turno
    switchTurn();
  }

  // ==========================================================
  // 23) TIMERS
  // ==========================================================
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
          const winner = color === "w" ? "Azules" : "Rosas";
          showEndGameModal(winner + " ganan por tiempo");
        }
      }
    }, 500);
  }

  function stopTimer(color) {
    clearInterval(timerIntervals[color]);
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
  }

  function updateTimersDisplay() {
    const disp = (sec) => (Number.isFinite(sec) ? formatTime(sec) : "∞");

    if (humanColor === "w") {
      player1TimerEl.textContent = disp(timers.b);
      player2TimerEl.textContent = disp(timers.w);
    } else {
      player1TimerEl.textContent = disp(timers.w);
      player2TimerEl.textContent = disp(timers.b);
    }
  }

  // ==========================================================
  // 24) PUNTUACIÓN, REY, ERRORES Y CAMBIO DE TURNO
  // ==========================================================
  function updateScores() {
    const diffW = scores.w - scores.b;
    const diffB = scores.b - scores.w;

    if (humanColor === "w") {
      player2ScoreEl.textContent = "Puntos: +" + Math.max(diffW, 0);
      player1ScoreEl.textContent = "Puntos: +" + Math.max(diffB, 0);
    } else {
      player1ScoreEl.textContent = "Puntos: +" + Math.max(diffW, 0);
      player2ScoreEl.textContent = "Puntos: +" + Math.max(diffB, 0);
    }
  }

  function findKingPosition(color) {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (board[i][j] === color + "k") return { row: i, col: j };
      }
    }
    return null;
  }

  function updateKingStatus() {
    document
      .querySelectorAll(".cell.check, .cell.checkmate")
      .forEach((c) => c.classList.remove("check", "checkmate"));

    ["w", "b"].forEach((color) => {
      const pos = findKingPosition(color);
      if (!pos) return;
      const cell = getCell(pos.row, pos.col);
      if (isKingInCheck(color)) {
        cell.classList.add(isCheckmate(color) ? "checkmate" : "check");
      }
    });
  }

  function blinkCell(cell) {
    cell.classList.add("blink-error");
    setTimeout(() => cell.classList.remove("blink-error"), 400);
    playSound(errorSound, "error");
  }

  function switchTurn() {
    if (isReviewMode) return;

    stopTimer(currentTurn);
    currentTurn = currentTurn === "w" ? "b" : "w";
    startTimer(currentTurn);

    if (!isOnlineGame && currentTurn !== humanColor && !isReviewMode) {
      requestStockfishMove();
    } else {
      isAnimating = false;
    }
  }

  function syncProfilesUI() {
    const p1Name = document.querySelector("#player1 .player-name");
    const p2Name = document.querySelector("#player2 .player-name");
    const p1Img = document.querySelector("#player1 .profile-image img");
    const p2Img = document.querySelector("#player2 .profile-image img");

    if (isOnlineGame) {
      p1Name.textContent = "Rival online";
      p1Img.src = "assets/images/human-img-profile.jpg";
      p2Name.textContent = "Tú";
      p2Img.src = "assets/images/human-img-profile.jpg";
      if (robotBadge) robotBadge.textContent = "";
    } else {
      p1Name.textContent = "GPR robot";
      p1Img.src = "assets/images/gpr-robotic-img.jpg";
      p2Name.textContent = "Jugador humano";
      p2Img.src = "assets/images/human-img-profile.jpg";
      if (robotBadge) robotBadge.textContent = `Nivel ${difficultyLevel}`;
    }
  }

  function requestStockfishMove() {
    if (!stockfishWorker) initStockfish();
    console.log("[SF] go", boardToFEN());
    startRobotThinkingAnimation();

    const fen = boardToFEN();
    stockfishWorker.postMessage("uci");
    setTimeout(() => {
      stockfishWorker.postMessage("ucinewgame");
      setTimeout(() => {
        if (difficultyLevel < 10) {
          const skl = getSkillForLevel(difficultyLevel);
          stockfishWorker.postMessage(
            "setoption name UCI_LimitStrength value true"
          );
          stockfishWorker.postMessage(
            "setoption name Skill Level value " + skl
          );
        } else {
          stockfishWorker.postMessage(
            "setoption name UCI_LimitStrength value false"
          );
        }
        setTimeout(() => {
          stockfishWorker.postMessage("position fen " + fen);
          const mt = getMovetimeForLevel(difficultyLevel);
          stockfishWorker.postMessage("go movetime " + mt);
        }, 100);
      }, 100);
    }, 100);
  }

  function processBestMove(uciMove) {
    if (isReviewMode) return;
    stopRobotThinkingAnimation();

    const files = "abcdefgh";
    const fromCol = files.indexOf(uciMove[0]);
    const fromRow = 8 - parseInt(uciMove[1], 10);
    const toCol = files.indexOf(uciMove[2]);
    const toRow = 8 - parseInt(uciMove[3], 10);

    const from = { row: fromRow, col: fromCol };
    const to = { row: toRow, col: toCol };

    // ✅ Si Stockfish propone algo ilegal para tu motor, no lo ejecutes
    if (!isValidMove(from, to)) {
      console.warn(
        "[SF] Movimiento ilegal propuesto:",
        uciMove,
        "FEN:",
        boardToFEN()
      );
      // Reintento rápido
      setTimeout(() => forceRobotThinkNow(), 50);
      return;
    }

    movePiece(from, to);
  }

  function forceRobotThinkNow() {
    initStockfish();
    const fen = boardToFEN();
    const mt = getMovetimeForLevel(difficultyLevel);

    stockfishWorker.postMessage("uci");
    setTimeout(() => {
      stockfishWorker.postMessage("ucinewgame");
      setTimeout(() => {
        if (difficultyLevel < 10) {
          stockfishWorker.postMessage(
            "setoption name UCI_LimitStrength value true"
          );
          stockfishWorker.postMessage(
            "setoption name Skill Level value " +
              getSkillForLevel(difficultyLevel)
          );
        } else {
          stockfishWorker.postMessage(
            "setoption name UCI_LimitStrength value false"
          );
        }
        setTimeout(() => {
          stockfishWorker.postMessage("position fen " + fen);
          stockfishWorker.postMessage("go movetime " + mt);
        }, 100);
      }, 100);
    }, 100);
  }

  // ==========================================================
  // 25) HISTORIAL DE MOVIMIENTOS (UI, navegación, scroll)
  // ==========================================================
  function logMove(piece, toText) {
    const history = document.querySelector(".move-history");
    const moveNumber = history.children.length + 1;

    const entry = document.createElement("div");
    entry.classList.add("move-entry");

    const numSpan = document.createElement("span");
    numSpan.textContent = moveNumber + ". ";
    numSpan.style.fontWeight = "bold";
    entry.appendChild(numSpan);

    const img = document.createElement("img");
    img.src = pieceImages[piece.color + piece.type];
    img.alt = piece.type;
    entry.appendChild(img);

    const span = document.createElement("span");
    span.textContent = toText;
    entry.appendChild(span);

    history.appendChild(entry);
    history.scrollLeft = history.scrollWidth;
  }

  function addHistoryEntry(pieceCode, coord) {
    const historyContainer = document.querySelector(".move-history");
    const moveNumber = historyContainer.children.length + 1;

    const entry = document.createElement("div");
    entry.className = "move-entry";

    const numSpan = document.createElement("span");
    numSpan.textContent = moveNumber + ". ";
    numSpan.style.fontWeight = "bold";
    entry.appendChild(numSpan);

    const img = document.createElement("img");
    img.src = pieceImages[pieceCode];
    img.alt = pieceCode;
    entry.appendChild(img);

    const span = document.createElement("span");
    span.textContent = coord;
    entry.appendChild(span);

    historyContainer.appendChild(entry);
    historyContainer.scrollLeft = historyContainer.scrollWidth;
  }

  function diffSnapshotsAll(oldB, newB) {
    const diffs = [];
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const o = oldB[i][j];
        const n = newB[i][j];
        if (o !== n) diffs.push({ row: i, col: j, from: o, to: n });
      }
    }
    return diffs;
  }

  function syncHistoryScroll(index) {
    const entries = historyContainer.children;
    if (entries[index]) {
      const el = entries[index];
      historyContainer.scrollLeft =
        el.offsetLeft - historyContainer.clientWidth / 2 + el.clientWidth / 2;
    }
  }

  function handleHistoryStep(direction) {
    if (isNavigating) return;
    isNavigating = true;
    navPrevBtn.disabled = navNextBtn.disabled = true;

    const atStart = currentHistoryIndex <= 0;
    const atEnd = currentHistoryIndex >= positionHistory.length - 1;
    if ((direction === -1 && atStart) || (direction === 1 && atEnd)) {
      isNavigating = false;
      navPrevBtn.disabled = navNextBtn.disabled = false;
      return;
    }

    const oldBoard = getBoardPositionSnapshot();
    currentHistoryIndex += direction;
    syncHistoryFromSnapshot(currentHistoryIndex);
    const newBoard = getBoardPositionSnapshot();

    board = oldBoard;
    renderBoard();
    const diffs = diffSnapshotsAll(oldBoard, newBoard);

    if (direction === -1) {
      if (historyContainer.lastElementChild) {
        historyContainer.removeChild(historyContainer.lastElementChild);
      }
      if (diffs.length > 2 && historyContainer.lastElementChild) {
        historyContainer.removeChild(historyContainer.lastElementChild);
      }
    } else if (direction === 1 && diffs.length === 2) {
      const mover = positionHistory[currentHistoryIndex].lastMoveBy;
      const fromDiff = diffs.find((d) => d.from !== null);
      const toDiff = diffs.find((d) => d.from === null);
      const file = "abcdefgh"[toDiff.col];
      const rank = 8 - toDiff.row;
      logMove({ color: mover, type: fromDiff.from[1] }, file + rank);
    }

    if (diffs.length === 2) {
      const fromDiff = diffs.find((d) => d.from !== null);
      const toDiff = diffs.find((d) => d !== fromDiff);
      const fromCell = getCell(fromDiff.row, fromDiff.col);
      const toCell = getCell(toDiff.row, toDiff.col);
      const img = fromCell.querySelector("img");
      if (img) {
        playSound(moveSound, "move");
        animatePieceMove(img, fromCell, toCell, () => {
          board = newBoard;
          renderBoard();
          updateKingStatus();
          removeMoveIndicators();
          removeLastMoveHighlights();
          syncHistoryScroll(currentHistoryIndex);
          isNavigating = false;
          navPrevBtn.disabled = navNextBtn.disabled = false;
        });
        return;
      }
    }

    board = newBoard;
    renderBoard();
    updateKingStatus();
    removeMoveIndicators();
    removeLastMoveHighlights();
    updateScores();
    syncHistoryScroll(currentHistoryIndex);
    isNavigating = false;
    navPrevBtn.disabled = navNextBtn.disabled = false;
  }

  navPrevBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    handleHistoryStep(-1);
  });

  navNextBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    handleHistoryStep(+1);
  });

  undoBtn?.addEventListener("pointerup", (e) => {
    e.preventDefault();
    historyContainer.scrollBy({ left: -SCROLL_STEP, behavior: "smooth" });
  });

  redoBtn?.addEventListener("pointerup", (e) => {
    e.preventDefault();
    historyContainer.scrollBy({ left: SCROLL_STEP, behavior: "smooth" });
  });

  // ==========================================================
  // 26) INICIO Y RESETEO DE PARTIDA
  // ==========================================================
  function actuallyStartGame() {
    syncProfilesUI();

    maxHealth = { w: 39 + kingBaseHealth, b: 39 + kingBaseHealth };
    currentHealth = { ...maxHealth };

    scores = { w: 0, b: 0 };
    updateScores();
    updateHealthBar();

    if (selectedTime == null || isNaN(selectedTime)) {
      selectedTime = Infinity;
    }

    timers = { w: selectedTime, b: selectedTime };

    setupInitialBoard();
    renderBoard();
    updateTimersDisplay();

    if (Number.isFinite(timers[currentTurn])) {
      startTimer(currentTurn);
    }

    // ⭐ CLAVE
    if (!isOnlineGame && humanColor === "b") {
      setTimeout(() => {
        requestStockfishMove();
      }, 300);
    }
  }

  if (playButton) {
    playButton.addEventListener("pointerup", () => {
      // --- 1) Tiempo por defecto: infinito si no se ha seleccionado ---
      if (selectedTime == null || isNaN(selectedTime)) {
        selectedTime = Infinity;
        console.log("Tiempo no seleccionado → modo infinito");
      }

      const gameContainer = document.getElementById("gameContainer");
      const gameSetup = document.getElementById("gameSetup");
      const mainHeader = document.querySelector("header");

      // ⚠️ IMPORTANTE:
      // Ya NO paramos la música del menú ni arrancamos la de juego aquí.
      // Eso se hará cuando realmente entremos en la partida.

      // Aseguramos contenedores visibles detrás del overlay
      if (gameContainer) gameContainer.classList.remove("hidden");
      if (chessContainer) chessContainer.classList.remove("hidden");

      // Si NO hubiera overlay de carga, empezamos directamente
      if (!pregameOverlay) {
        playButton.classList.add("hidden");

        if (gameSetup) {
          gameSetup.style.display = "none";
          gameSetup.classList.add("hidden");
        }
        if (mainHeader) {
          mainHeader.classList.add("hidden");
        }

        document.body.classList.add("game-active");

        // Paramos música menú y arrancamos música de juego
        menuMusic.pause();
        playGameMusic();

        if (!hasGameStartedFromMenu) {
          hasGameStartedFromMenu = true;
          actuallyStartGame();
        }
        return;
      }

      // --- 2) Mostrar overlay de carga pre-partida ---
      pregameOverlay.style.opacity = 1;
      pregameOverlay.style.display = "flex";
      pregameProgress.style.width = "0%";
      pregamePercent.textContent = "0%";

      let progress = 0;

      const interval = setInterval(() => {
        // Simulación de progreso
        progress += Math.random() * 12;
        if (progress > 100) progress = 100;

        pregameProgress.style.width = progress + "%";
        pregamePercent.textContent = Math.floor(progress) + "%";

        if (progress >= 100) {
          clearInterval(interval);

          // --- 3) Inicializar la partida MIENTRAS el overlay todavía está encima ---
          // Así el tablero y toda la lógica se preparan "por detrás"
          if (!hasGameStartedFromMenu) {
            hasGameStartedFromMenu = true;
            actuallyStartGame();
          }

          // Ocultamos menú y header ya, aún cubiertos por el overlay → sin flash
          if (gameSetup) {
            gameSetup.style.display = "none";
            gameSetup.classList.add("hidden");
          }
          if (mainHeader) {
            mainHeader.classList.add("hidden");
          }

          document.body.classList.add("game-active");

          // --- 4) Pequeña transición de fade del overlay ---
          setTimeout(() => {
            pregameOverlay.style.opacity = 0;

            setTimeout(() => {
              pregameOverlay.style.display = "none";
              playButton.classList.add("hidden");

              if (isOnlineGame) {
                onlineChoice?.classList.add("hidden");
                onlineLobby?.classList.add("hidden");
              }

              if (gameContainer) gameContainer.classList.remove("hidden");
              if (chessContainer) chessContainer.classList.remove("hidden");

              // --- 5) AHORA sí: cambiamos la música ---
              // Se ejecuta cuando el tablero ya está visible.
              menuMusic.pause();
              playGameMusic();
            }, 400); // tiempo del fade-out
          }, 300); // pausa breve tras llegar al 100%
        }
      }, 150);
    });
  }

  function resetGame(skipConfirm = false) {
    const gameContainerEl = document.getElementById("gameContainer");
    const gameSetupEl = document.getElementById("gameSetup");

    hasGameStartedFromMenu = false;

    if (gameContainerEl) gameContainerEl.classList.add("hidden");
    if (gameSetupEl) gameSetupEl.classList.remove("hidden");

    if (!skipConfirm) {
      if (!confirm("¿Reiniciar partida?")) return;
    }

    stopTimer("w");
    stopTimer("b");

    menuMusic.play().catch(() => {});
    gameMusic.pause();

    isOnlineGame = false;
    currentRoomId = null;

    selectedTime = null;

    const mainHeader = document.querySelector("header");
    if (mainHeader) {
      mainHeader.classList.remove("hidden");
    }
    document.body.classList.remove("game-active");

    if (mainSection) mainSection.style.display = "block";
    if (chessContainer) chessContainer.classList.add("hidden");

    const history = document.querySelector(".move-history");
    history.innerHTML = "";

    setupInitialBoard();
    renderBoard();
    updateKingStatus();
    repetitionCount.clear();
  }

  function repeatGame() {
    // Para timers
    stopTimer("w");
    stopTimer("b");

    // Limpia flags / estados
    isReviewMode = false;
    isAnimating = false;
    isNavigating = false;
    selectedCell = null;
    removeMoveIndicators?.();
    removeLastMoveHighlights?.();

    // Resetea enroques y en passant
    kingMoved = { w: false, b: false };
    rookMoved = {
      w: { left: false, right: false },
      b: { left: false, right: false },
    };
    enPassantTarget = null;

    // Salud y score
    maxHealth = { w: 39 + kingBaseHealth, b: 39 + kingBaseHealth };
    currentHealth = { ...maxHealth };
    scores = { w: 0, b: 0 };
    updateScores();
    updateHealthBar();

    // Limpia historial UI
    document.querySelector(".move-history").innerHTML = "";
    positionHistory = [];
    currentHistoryIndex = 0;

    // Turno inicial (blancas siempre)
    currentTurn = "w";

    // Tiempo
    if (selectedTime == null || isNaN(selectedTime)) selectedTime = Infinity;
    timers = { w: selectedTime, b: selectedTime };
    updateTimersDisplay();

    // Reinicia tablero
    setupInitialBoard();
    renderBoard();
    updateKingStatus();

    // Arranca reloj solo si es finito
    if (Number.isFinite(timers[currentTurn])) startTimer(currentTurn);

    // Si humano juega AZULES (b), el robot (blancas) debe mover primero
    if (!isOnlineGame && humanColor === "b") {
      requestStockfishMove();
    }
    repetitionCount.clear();
  }

  // ==========================================================
  // INICIO
  // ==========================================================

  window.addEventListener("beforeunload", () => {
    socket?.close?.();
  });
});
