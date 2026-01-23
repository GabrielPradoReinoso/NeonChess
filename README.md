♟️ NEON CHESS

NEON CHESS is a web-based chess game with a neon / cyberpunk aesthetic, focused on smooth animations, rich visual feedback, and robust game-state handling.

The project supports local play, AI matches powered by Stockfish, and real-time online multiplayer via a Node.js + Socket.IO backend.

✨ Features
🎮 Game Modes

Local Player vs Player

Player vs AI (Stockfish) — configurable difficulty

Online Multiplayer (1v1) — real-time via Socket.IO (backend required)

🧠 Gameplay & Logic

Full chess rules implemented:

Castling

En-passant

Pawn promotion

Check, checkmate, stalemate

Draw detection (repetition / insufficient material)

Timers per player

Health & score system based on captures

Strict turn and state validation

📜 Advanced Move History

Fully animated move history

Step-by-step navigation (Prev / Next)

Review mode isolated from live gameplay

Correct handling of captures, castling and en-passant

Automatic scroll to the latest move

Stable exit from review back to live game

🎨 Visuals & UX

Neon / cyberpunk UI

Smooth piece animations

Capture VFX

Matrix-style AI thinking overlay

Sound effects for:

Moves

Captures

Errors

Game events

Responsive layout

🌐 Online Features

Room-based matchmaking

Reconnection handling

Move sequencing and deduplication

Player chat

Connection status indicators

🧱 Architecture
Frontend

HTML / CSS / JavaScript

Runs as a static site

Compatible with:

GitHub Pages

Firebase Hosting

Backend (required for online mode)

Node.js

Express

Socket.IO

Manages:

Rooms

Turns

Reconnections

Chat

Move validation

🚀 Live Demo
GitHub Pages

➡️ Local play & AI only

Online multiplayer is disabled on GitHub Pages due to platform limitations.

Why?
GitHub Pages does not support WebSockets or persistent backend processes.

🕹️ Running Locally
1️⃣ Frontend (Local & AI modes)

You can run the frontend using any static server.

Example using live-server:

cd docs
npx live-server

2️⃣ Online Multiplayer (Local Development)

To test online play locally, both frontend and backend must be running.

Terminal A — Backend
cd docs
npm install
npm run server


Backend will listen on:

http://localhost:8080

Terminal B — Frontend
cd docs
npm run web


Frontend available at:

http://localhost:3000

🧪 Testing with Two Players

Open two different browsers (or one browser + incognito)

Visit http://localhost:3000 in both

Create a room in one browser

Join the room from the other

🗂️ Project Structure (Simplified)
NeonChess/
├─ docs/              # Frontend (static)
│  ├─ index.html
│  ├─ css/
│  ├─ js/
│  │  ├─ script.js    # Main game logic
│  │  └─ stockfish/   # AI engine
│  └─ server.js       # Backend (Socket.IO)
│
├─ documents/         # Notes & internal documentation
└─ README.md

🏷️ Versioning

baseline-2026-01-21
Initial stable snapshot before major refactors

v0.4.0-history-stable
Refactored core logic with fully restored animated move history

🔮 Roadmap

PGN export / import

Spectator mode

Ranked matchmaking

Persistent player statistics

Fully server-authoritative rule validation

📄 License

This project is intended for educational and portfolio purposes.

Feel free to explore, fork, and experiment.