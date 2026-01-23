# ♟️ NEON CHESS

NEON CHESS is a web-based chess game with a neon / cyberpunk aesthetic, focused on smooth animations, rich visual feedback, and robust game-state handling.

It supports local play, AI matches powered by Stockfish, and real-time online multiplayer via Socket.IO (backend required).

---

## ✨ Features

### 🎮 Game Modes
- **Local Player vs Player**
- **Player vs AI (Stockfish)** — configurable difficulty
- **Online Multiplayer (1v1)** — real-time via Socket.IO

### 🧠 Gameplay & Logic
- Full chess rules:
  - Castling
  - En-passant
  - Pawn promotion
  - Check, checkmate, stalemate
  - Draw detection (repetition / insufficient material)
- Timers per player
- Health / score system based on captures

### 📜 Advanced Move History
- Fully animated move history
- Step-by-step navigation (Prev / Next)
- Review mode isolated from live gameplay
- Correct handling of captures, castling and en-passant
- Auto-scroll to latest move

### 🎨 Visuals & UX
- Neon / cyberpunk UI
- Smooth piece animations
- Capture VFX
- Matrix-style AI thinking overlay
- Sound effects for moves, captures, errors and events
- Responsive layout

### 🌐 Online Features
- Room-based matchmaking
- Reconnection handling
- Move deduplication and sequencing
- Chat between players
- Connection status indicators

---

## 🧱 Architecture

### Frontend
- HTML / CSS / JavaScript (ES Modules)
- Runs as a static site
- Compatible with GitHub Pages and Firebase Hosting

### Backend (required for online mode)
- Node.js + Express
- Socket.IO
- Manages rooms, turns, reconnections and chat

---

## 🚀 Live Demo

### GitHub Pages
➡️ **Local play & AI only**  
Online multiplayer is disabled due to platform limitations.

> GitHub Pages does not support WebSockets or persistent backend processes.

---

## 🕹️ Running Locally

### 1️⃣ Frontend (Local / AI)

You can run the frontend using any static server.

Example using `live-server`:

```bash
cd docs
npx live-server
