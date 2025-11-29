const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const rooms = {}; // { roomId: { players: [], deck: [], currentTurn: 0 } }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', (data) => {
    const { roomId, playerName } = data;
    if (!rooms[roomId]) {
      rooms[roomId] = { players: [], deck: [], currentTurn: 0 };
    }
    if (rooms[roomId].players.length < 4) {
      rooms[roomId].players.push({ id: socket.id, name: playerName, hand: [] });
      socket.join(roomId);
      socket.emit('joinedRoom', { success: true, roomId, players: rooms[roomId].players.length });
      io.to(roomId).emit('roomStatus', { players: rooms[roomId].players.length });
      if (rooms[roomId].players.length === 4) {
        startGame(roomId);
      }
    } else {
      socket.emit('joinedRoom', { success: false, message: 'Phòng đầy!' });
    }
  });

  socket.on('playCard', (data) => {
    const { roomId, card } = data;
    const room = rooms[roomId];
    if (room) {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex === room.currentTurn) {
        const player = room.players[playerIndex];
        player.hand = player.hand.filter(c => c !== card);
        room.currentTurn = (room.currentTurn + 1) % 4;
        io.to(roomId).emit('cardPlayed', { playerIndex, card, currentTurn: room.currentTurn });
        if (player.hand.length === 0) {
          io.to(roomId).emit('gameOver', { winner: player.name });
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

function startGame(roomId) {
  const room = rooms[roomId];
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  let deck = [];
  for (let s of suits) for (let r of ranks) deck.push(`${r}${s}`);
  // Xào bài ngẫu nhiên server-side
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  room.deck = deck;
  room.players.forEach((player, index) => {
    player.hand = deck.splice(0, 13);
    player.hand.sort((a, b) => a.localeCompare(b));
  });
  // Gửi riêng cho từng player (bảo mật: chỉ hand của mình)
  room.players.forEach(player => {
    const playerIndex = room.players.findIndex(p => p.id === player.id);
    io.to(player.id).emit('gameStarted', {
      myHand: player.hand,
      currentTurn: room.currentTurn,
      players: room.players.map(p => p.name)
    });
  });
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
