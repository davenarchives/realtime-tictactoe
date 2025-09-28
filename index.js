const path = require("path");
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
const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function checkResult(b) {
  for (const [a, c, d] of lines) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]; 
  }
  if (b.every(Boolean)) return "Draw";
  return null;
}

function resetGame(keepSeats = true) {
  board = Array(9).fill(null);
  turn  = "X";
  if (!keepSeats) players = { X: null, O: null };
}

io.on("connection", (socket) => {
  let mySymbol = null;
  if (!players.X) { players.X = socket.id; mySymbol = "X"; }
  else if (!players.O) { players.O = socket.id; mySymbol = "O"; }

  socket.emit("init", {
    yourSymbol: mySymbol,
    board,
    turn,
    players
  });

  io.emit("players", players);

  socket.on("move", (index) => {
    if (mySymbol == null) return;             
    if (players[turn] !== socket.id) return;     
    if (board[index] != null) return;        

    board[index] = turn;
    const result = checkResult(board);

    if (result) {
      io.emit("state", { board, turn: null, result }); 
      resetGame(true);                               
    } else {
      turn = turn === "X" ? "O" : "X";
      io.emit("state", { board, turn, result: null }); 
    }
  });

  socket.on("reset", () => {
    resetGame(true);
    io.emit("state", { board, turn, result: null });
  });

  socket.on("disconnect", () => {
    if (players.X === socket.id) players.X = null;
    if (players.O === socket.id) players.O = null;
    if (!players.X && !players.O) resetGame(false); 
    io.emit("players", players);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
