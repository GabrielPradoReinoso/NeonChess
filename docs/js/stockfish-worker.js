// docs/js/stockfish-worker.js
let engine = null;

// 1) Build que expone Stockfish()
try {
  importScripts("stockfish.js"); // ✅ relativo al propio worker (/NeonChess/js/)
  if (typeof Stockfish === "function") {
    engine = Stockfish();
  }
} catch (e) {}

// 2) Fallback: build donde stockfish.js ya es un worker script
if (!engine) {
  try {
    engine = new Worker("stockfish.js"); // ✅ relativo también
  } catch (e) {}
}

if (!engine) {
  self.postMessage("error:stockfish_init_failed");
} else {
  engine.onmessage = (e) => self.postMessage(e.data);
  self.onmessage = (e) => engine.postMessage(e.data);
}
