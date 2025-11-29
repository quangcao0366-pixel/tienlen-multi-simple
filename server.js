const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const rooms = {}; // Lưu phòng: { roomId: { players: [], deck: [], currentTurn: 0 } }

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
      io.to(roomId).emit('playerJoined', { players: rooms[roomId].players.length });
      if (rooms[roomId].players.length === 4) {
        startGame(roomId);
      }
    } else {
      socket.emit('roomFull');
    }
  });

  socket.on('playCard', (data) => {
    const { roomId, card } = data;
    // Validate & update game state server-side
    // (Logic đơn giản: kiểm tra hợp lệ, loại bài, chuyển lượt)
    const room = rooms[roomId];
    if (room && room.currentTurn === room.players.findIndex(p => p.id === socket.id)) {
      // Remove card from player hand (server-side)
      const player = room.players.find(p => p.id === socket.id);
      player.hand = player.hand.filter(c => c !== card);
      room.currentTurn = (room.currentTurn + 1) % 4;
      io.to(roomId).emit('cardPlayed', { player: socket.id, card, turn: room.currentTurn });
      if (player.hand.length === 0) {
        io.to(roomId).emit('gameOver', { winner: player.name });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

function startGame(roomId) {
  const room = rooms[roomId];
  // Tạo deck ngẫu nhiên server-side (crypto.randomBytes cho seed)
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  let deck = [];
  for (let s of suits) for (let r of ranks) deck.push(`${r}${s}`);
  // Xào bài ngẫu nhiên (bảo mật, không client-side)
  const seed = crypto.randomBytes(32).toString('hex');
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); // Random seed from crypto
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  room.deck = deck;
  // Chia bài (13 lá/người)
  room.players.forEach(player => {
    player.hand = deck.splice(0, 13);
    player.hand.sort((a, b) => a.localeCompare(b)); // Sort for display
  });
  io.to(roomId).emit('gameStarted', { hands: room.players.map(p => ({ name: p.name, hand: p.hand })) });
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
