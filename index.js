const express = require("express")
const http = require("http")
const { Server } = require("socket.io")

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(express.static(__dirname))

let players = { X: null, O: null }
let board = Array(9).fill(null)
let turn = "X"
let modeVotes = { X: null, O: null }
let selectedMode = null
let currentRound = 0
let totalRounds = 1
let seriesScore = { X: 0, O: 0 }
let originalPlayers = { player1: null, player2: null } // player1 starts as X, player2 as O

const lines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]
const playerMeta = new Map()

const MODES = {
  BLITZ: { name: "BLITZ", rounds: 1, description: "1 Round Match" },
  SKIRMISH: { name: "SKIRMISH", rounds: 3, description: "3 Rounds Match" },
  DEATHMATCH: { name: "DEATHMATCH", rounds: 5, description: "5 Rounds Match" },
  RANDOM: { name: "RANDOM", rounds: 0, description: "Random Mode" },
}

function checkResult(b) {
  for (const [a, c, d] of lines) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]
  }
  if (b.every(Boolean)) return "Draw"
  return null
}

function resetGame(keepSeats = true) {
  board = Array(9).fill(null)
  turn = "X"
  if (!keepSeats) players = { X: null, O: null }
}

function resetModeSelection() {
  modeVotes = { X: null, O: null }
  selectedMode = null
  currentRound = 0
  totalRounds = 1
  seriesScore = { X: 0, O: 0 }
  originalPlayers = { player1: null, player2: null }
}

function determineMode() {
  const xVote = modeVotes.X
  const oVote = modeVotes.O

  if (!xVote || !oVote) return null

  if (xVote === oVote) {
    if (xVote === "RANDOM") {
      const modes = ["BLITZ", "SKIRMISH", "DEATHMATCH"]
      return modes[Math.floor(Math.random() * modes.length)]
    }
    return xVote
  }

  if (xVote === "RANDOM") {
    const modes = ["BLITZ", "SKIRMISH", "DEATHMATCH"]
    return modes[Math.floor(Math.random() * modes.length)]
  }
  return xVote
}

function assignSymbolsForRound(roundNumber) {
  if (!originalPlayers.player1 || !originalPlayers.player2) return

  const isOddRound = roundNumber % 2 === 1

  if (isOddRound) {
    players.X = originalPlayers.player1
    players.O = originalPlayers.player2
  } else {
    players.X = originalPlayers.player2
    players.O = originalPlayers.player1
  }

  const player1Meta = playerMeta.get(originalPlayers.player1.id)
  const player2Meta = playerMeta.get(originalPlayers.player2.id)

  if (player1Meta) {
    player1Meta.symbol = isOddRound ? "X" : "O"
    playerMeta.set(originalPlayers.player1.id, player1Meta)
  }

  if (player2Meta) {
    player2Meta.symbol = isOddRound ? "O" : "X"
    playerMeta.set(originalPlayers.player2.id, player2Meta)
  }

  console.log(
    `[v0] Round ${roundNumber}: player1 (${originalPlayers.player1.id.slice(0, 6)}) is ${isOddRound ? "X" : "O"}, player2 (${originalPlayers.player2.id.slice(0, 6)}) is ${isOddRound ? "O" : "X"}`,
  )
}

function publicPlayers() {
  return {
    X: players.X ? { name: players.X.name } : null,
    O: players.O ? { name: players.O.name } : null,
  }
}

function returnPlayersToLobby() {
  const activePlayers = [players.X, players.O].filter(Boolean)
  const ids = activePlayers.map((player) => player.id)

  resetGame(false)
  resetModeSelection()

  ids.forEach((id) => {
    const meta = playerMeta.get(id)
    if (meta) {
      meta.symbol = null
      playerMeta.set(id, meta)
    }
  })

  io.emit("series_reset")
  io.emit("players", publicPlayers())
  io.emit("state", { board, turn, result: null, players: publicPlayers() })
}

io.on("connection", (socket) => {
  playerMeta.set(socket.id, { symbol: null, name: null })

  socket.emit("init", {
    yourSymbol: null,
    board,
    turn,
    result: checkResult(board),
    players: publicPlayers(),
    modeVotes,
    selectedMode,
    currentRound,
    totalRounds,
    seriesScore,
  })

  socket.on("join", ({ name } = {}) => {
    const trimmedName = typeof name === "string" ? name.trim() : ""
    if (!trimmedName) {
      socket.emit("join_error", { message: "Please enter a valid name." })
      return
    }

    const meta = playerMeta.get(socket.id) || { symbol: null, name: null }
    meta.name = trimmedName

    if (meta.symbol && players[meta.symbol] && players[meta.symbol].id === socket.id) {
      players[meta.symbol].name = trimmedName
      playerMeta.set(socket.id, meta)
      socket.emit("joined", {
        name: trimmedName,
        yourSymbol: meta.symbol,
        board,
        turn,
        result: checkResult(board),
        players: publicPlayers(),
        modeVotes,
        selectedMode,
        currentRound,
        totalRounds,
        seriesScore,
      })
      io.emit("players", publicPlayers())
      return
    }

    const seat = !players.X ? "X" : !players.O ? "O" : null
    if (!seat) {
      playerMeta.set(socket.id, meta)
      socket.emit("waiting", { message: "Game already has two players. Waiting for a seat..." })
      return
    }

    meta.symbol = seat
    playerMeta.set(socket.id, meta)
    players[seat] = { id: socket.id, name: trimmedName }

    if (!originalPlayers.player1) {
      originalPlayers.player1 = players[seat]
    } else if (!originalPlayers.player2) {
      originalPlayers.player2 = players[seat]
    }

    socket.emit("joined", {
      name: trimmedName,
      yourSymbol: seat,
      board,
      turn,
      result: checkResult(board),
      players: publicPlayers(),
      modeVotes,
      selectedMode,
      currentRound,
      totalRounds,
      seriesScore,
    })
    io.emit("players", publicPlayers())

    if (players.X && players.O && !selectedMode) {
      io.emit("mode_selection_start")
    }
  })

  socket.on("vote_mode", (mode) => {
    const meta = playerMeta.get(socket.id)
    if (!meta || !meta.symbol) return
    if (!MODES[mode]) return
    if (selectedMode) return

    modeVotes[meta.symbol] = mode
    io.emit("mode_votes", modeVotes)

    if (modeVotes.X && modeVotes.O) {
      selectedMode = determineMode()
      totalRounds = MODES[selectedMode].rounds
      currentRound = 1

      io.emit("mode_selected", {
        mode: selectedMode,
        totalRounds,
        currentRound,
        modeVotes,
      })
    }
  })

  socket.on("move", (index) => {
    const meta = playerMeta.get(socket.id)
    if (!meta || !meta.symbol) return
    if (!Number.isInteger(index) || index < 0 || index >= 9) return

    if (turn !== meta.symbol) {
      console.log(`[v0] Move rejected: turn is ${turn}, player symbol is ${meta.symbol}`)
      return
    }

    if (board[index] != null) return
    if (!selectedMode) return

    board[index] = turn
    const result = checkResult(board)

    if (result) {
      if (result === "X" || result === "O") {
        seriesScore[result] += 1
      }

      io.emit("state", {
        board,
        turn: null,
        result,
        players: publicPlayers(),
        currentRound,
        totalRounds,
        seriesScore,
      })

      const roundsToWin = Math.ceil(totalRounds / 2)
      const hasSeriesWinner = seriesScore.X >= roundsToWin || seriesScore.O >= roundsToWin
      const allRoundsPlayed = currentRound >= totalRounds

      if (hasSeriesWinner || allRoundsPlayed) {
        let seriesWinner = null
        if (seriesScore.X > seriesScore.O) {
          seriesWinner = "X"
        } else if (seriesScore.O > seriesScore.X) {
          seriesWinner = "O"
        }

        setTimeout(() => {
          io.emit("series_complete", {
            winner: seriesWinner,
            score: seriesScore,
          })
        }, 1500)
      } else {
        setTimeout(() => {
          currentRound += 1
          resetGame(true)

          if (totalRounds > 1) {
            assignSymbolsForRound(currentRound)
          }

          const symbolMap = {}
          if (players.X) {
            symbolMap[players.X.id] = "X"
          }
          if (players.O) {
            symbolMap[players.O.id] = "O"
          }

          io.emit("next_round", {
            currentRound,
            totalRounds,
            seriesScore,
            players: publicPlayers(),
            symbolMap,
          })

          io.emit("state", {
            board,
            turn,
            result: null,
            players: publicPlayers(),
            currentRound,
            totalRounds,
            seriesScore,
          })
        }, 1500)
      }
    } else {
      turn = turn === "X" ? "O" : "X"
      io.emit("state", {
        board,
        turn,
        result: null,
        players: publicPlayers(),
        currentRound,
        totalRounds,
        seriesScore,
      })
    }
  })

  socket.on("reset", () => {
    const meta = playerMeta.get(socket.id)
    if (!meta || !meta.symbol) return
    resetGame(true)
    io.emit("state", {
      board,
      turn,
      result: null,
      players: publicPlayers(),
      currentRound,
      totalRounds,
      seriesScore,
    })
  })

  socket.on("series_exit", () => {
    const meta = playerMeta.get(socket.id)
    if (!meta || !meta.symbol) return
    if (!players[meta.symbol] || players[meta.symbol].id !== socket.id) return
    returnPlayersToLobby()
  })

  socket.on("disconnect", () => {
    const meta = playerMeta.get(socket.id)
    const seat = meta && meta.symbol
    const isSeated = seat && players[seat] && players[seat].id === socket.id

    if (isSeated) {
      returnPlayersToLobby()
    }

    playerMeta.delete(socket.id)
    if (!players.X && !players.O) {
      resetGame(false)
      resetModeSelection()
    }

    io.emit("players", publicPlayers())
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log("Server running at http://localhost:" + PORT)
})
