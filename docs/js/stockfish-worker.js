// docs/js/stockfish-worker.js
// Wrapper que funciona tanto si stockfish.js exporta Stockfish() como si es un worker en sí.

let engine = null;

const STOCKFISH_URL = new URL("./stockfish.js", self.location).toString();

// 1) Intento: build que expone la función Stockfish()
try {
  importScripts(STOCKFISH_URL);
  if (typeof Stockfish === "function") {
    engine = Stockfish(); // crea el “pseudo-worker”
  }
} catch (e) {
  // ignoramos, probamos la otra vía
}

// 2) Fallback: build donde stockfish.js ya es un Worker script
if (!engine) {
  try {
    engine = new Worker(STOCKFISH_URL);
  } catch (e) {
    // seguimos sin engine
  }
}

// 3) Si no hay engine, avisamos sin romper el hilo principal
if (!engine) {
  self.postMessage("error:stockfish_init_failed");
} else {
  engine.onmessage = (e) => self.postMessage(e.data);
  self.onmessage = (e) => engine.postMessage(e.data);
}
