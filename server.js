const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', ({ roomId, playerName }) => {
    if (!roomId) roomId = 'default';
    if (!rooms[roomId]) rooms[roomId] = { players: [], currentTurn: 0, lastPlay: null, skipCount: 0 };

    if (rooms[roomId].players.length >= 4) {
      socket.emit('joinedRoom', { success: false, message: 'Phòng đầy!' });
      return;
    }

    const player = { id: socket.id, name: playerName || `Player${rooms[roomId].players.length + 1}`, hand: [] };
    rooms[roomId].players.push(player);
    socket.join(roomId);
    socket.emit('joinedRoom', { success: true, playerIndex: rooms[roomId].players.length - 1 });
    io.to(roomId).emit('roomUpdate', { players: rooms[roomId].players.map(p => p.name), count: rooms[roomId].players.length });

    if (rooms[roomId].players.length === 4) startGame(roomId);
  });

  socket.on('playCards', ({ roomId, cards }) => {
    const room = rooms[roomId];
    if (!room || room.players[room.currentTurn]?.id !== socket.id) return;

    const player = room.players[room.currentTurn];
    if (!isValidPlay(cards, room.lastPlay)) {
      socket.emit('invalidPlay');
      return;
    }

    // Loại bài khỏi tay
    cards.forEach(card => {
      const i = player.hand.indexOf(card);
      if (i > -1) player.hand.splice(i, 1);
    });

    room.lastPlay = cards;
    room.skipCount = 0;
    room.currentTurn = (room.currentTurn + 1) % 4;

    io.to(roomId).emit('cardsPlayed', { playerName: player.name, cards, nextTurn: room.currentTurn });
    if (player.hand.length === 0) io.to(roomId).emit('gameOver', { winner: player.name });
  });

  socket.on('skipTurn', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.players[room.currentTurn]?.id !== socket.id) return;

    room.skipCount++;
    room.currentTurn = (room.currentTurn + 1) % 4;

    if (room.skipCount === 3 && room.lastPlay) {
      room.lastPlay = null;
      room.skipCount = 0;
      io.to(roomId).emit('newRound');
    }

    io.to(roomId).emit('turnSkipped', { nextTurn: room.currentTurn });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Xử lý rời phòng sau (nếu cần)
  });
});

function startGame(roomId) {
  const room = rooms[roomId];
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  let deck = [];
  for (let s of suits) for (let r of ranks) deck.push(r + s);

  // Xào bài
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  room.players.forEach(p => {
    p.hand = deck.splice(0, 13).sort((a, b) => {
      const rankA = ranks.indexOf(a.slice(0, -1));
      const rankB = ranks.indexOf(b.slice(0, -1));
      return rankA - rankB;
    });
  });

  room.currentTurn = Math.floor(Math.random() * 4); // Ai có 3♠ đi trước (giản thể random)
  room.lastPlay = null;
  room.skipCount = 0;

  room.players.forEach((p, i) => {
    io.to(p.id).emit('gameStarted', {
      hand: p.hand,
      myIndex: i,
      currentTurn: room.currentTurn,
      players: room.players.map(pl => pl.name)
    });
  });
}

// Kiểm tra nước đi hợp lệ (chỉ cơ bản, đủ chơi ngon)
function isValidPlay(cards, lastPlay) {
  if (!lastPlay) return true; // Đầu ván
  if (cards.length !== lastPlay.length) return false;

  const getValue = c => "3456789XJQKA2".indexOf(c.slice(0, -1));
  const cardValues = cards.map(getValue).sort((a,b)=>a-b);
  const lastValues = lastPlay.map(c => getValue(c)).sort((a,b)=>a-b);

  // Đôi, sảnh, tứ quý, 3 đôi thông...
  const isStraight = (arr) => arr.every((v,i) => i === 0 || v === arr[i-1] + 1);
  const isPairOrMore = (arr) => new Set(arr).size === 1 || (arr.length >= 3 && isStraight(arr));

  if (isPairOrMore(cardValues) && !isPairOrMore(lastValues)) return true;
  if (cardValues[cardValues.length-1] > lastValues[lastValues.length-1]) return true;

  return false;
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
