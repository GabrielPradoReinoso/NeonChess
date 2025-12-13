// js/parser-worker.js

self.onmessage = e => {
  const text = e.data + "";            // el string crudo que viene del worker de Stockfish
  const lines = text.trim().split("\n");
  const out = {};

  for (const line of lines) {
    const parts = line.trim().split(" ");
    switch (parts[0]) {
      case "bestmove":
        // capturamos sólo el movimiento (e.g. "e2e4")
        out.bestmove = parts[1];
        break;
      // si quieres parsear más info (depth, score, etc.), añade aquí más cases
    }
  }

  // devolvemos al hilo principal un objeto con la info ya extraída
  self.postMessage(out);
};
