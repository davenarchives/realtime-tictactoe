const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let players = { X: null, O: null };
let board = Array(9).fill(null);
let turn = "X";
const lines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];
const playerMeta = new Map();

function checkResult(b) {
  for (const [a, c, d] of lines) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  if (b.every(Boolean)) return "Draw";
  return null;
}

function resetGame(keepSeats = true) {
  board = Array(9).fill(null);
  turn = "X";
  if (!keepSeats) players = { X: null, O: null };
}

function publicPlayers() {
  return {
    X: players.X ? { name: players.X.name } : null,
    O: players.O ? { name: players.O.name } : null
  };
}

function returnPlayersToLobby() {
  const activePlayers = [players.X, players.O].filter(Boolean);
  const ids = activePlayers.map((player) => player.id);

  resetGame(false);

  ids.forEach((id) => {
    const meta = playerMeta.get(id);
    if (meta) {
      meta.symbol = null;
      playerMeta.set(id, meta);
    }
  });

  io.emit("series_reset");
  io.emit("players", publicPlayers());
  io.emit("state", { board, turn, result: null, players: publicPlayers() });
}

io.on("connection", (socket) => {
  playerMeta.set(socket.id, { symbol: null, name: null });

  socket.emit("init", {
    yourSymbol: null,
    board,
    turn,
    result: checkResult(board),
    players: publicPlayers()
  });

  socket.on("join", ({ name } = {}) => {
    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName) {
      socket.emit("join_error", { message: "Please enter a valid name." });
      return;
    }

    const meta = playerMeta.get(socket.id) || { symbol: null, name: null };
    meta.name = trimmedName;

    if (meta.symbol && players[meta.symbol] && players[meta.symbol].id === socket.id) {
      players[meta.symbol].name = trimmedName;
      playerMeta.set(socket.id, meta);
      socket.emit("joined", {
        name: trimmedName,
        yourSymbol: meta.symbol,
        board,
        turn,
        result: checkResult(board),
        players: publicPlayers()
      });
      io.emit("players", publicPlayers());
      return;
    }

    const seat = !players.X ? "X" : (!players.O ? "O" : null);
    if (!seat) {
      playerMeta.set(socket.id, meta);
      socket.emit("waiting", { message: "Game already has two players. Waiting for a seat..." });
      return;
    }

    meta.symbol = seat;
    playerMeta.set(socket.id, meta);
    players[seat] = { id: socket.id, name: trimmedName };

    socket.emit("joined", {
      name: trimmedName,
      yourSymbol: seat,
      board,
      turn,
      result: checkResult(board),
      players: publicPlayers()
    });
    io.emit("players", publicPlayers());
  });

  socket.on("move", (index) => {
    const meta = playerMeta.get(socket.id);
    if (!meta || !meta.symbol) return;
    if (!Number.isInteger(index) || index < 0 || index >= 9) return;
    if (!players[turn] || players[turn].id !== socket.id) return;
    if (board[index] != null) return;

    board[index] = turn;
    const result = checkResult(board);

    if (result) {
      io.emit("state", { board, turn: null, result, players: publicPlayers() });
      resetGame(true);
    } else {
      turn = turn === "X" ? "O" : "X";
      io.emit("state", { board, turn, result: null, players: publicPlayers() });
    }
  });

  socket.on("reset", () => {
    const meta = playerMeta.get(socket.id);
    if (!meta || !meta.symbol) return;
    resetGame(true);
    io.emit("state", { board, turn, result: null, players: publicPlayers() });
  });

  socket.on("series_exit", () => {
    const meta = playerMeta.get(socket.id);
    if (!meta || !meta.symbol) return;
    if (!players[meta.symbol] || players[meta.symbol].id !== socket.id) return;
    returnPlayersToLobby();
  });

  socket.on("disconnect", () => {
    const meta = playerMeta.get(socket.id);
    const seat = meta && meta.symbol;
    const isSeated = seat && players[seat] && players[seat].id === socket.id;

    if (isSeated) {
      returnPlayersToLobby();
    }

    playerMeta.delete(socket.id);
    if (!players.X && !players.O) {
      resetGame(false);
    }

    io.emit("players", publicPlayers());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running at http://localhost:" + PORT);
});
