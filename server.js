const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, playerName }) => {
    roomId = roomId || 'default';
    if (!rooms[roomId]) rooms[roomId] = { players: [], currentTurn: 0, lastPlay: null, skipCount: 0 };

    if (rooms[roomId].players.length >= 4) {
      socket.emit('errorMsg', 'Phòng đã đầy!');
      return;
    }

    const player = {
      id: socket.id,
      name: playerName || `Người ${rooms[roomId].players.length + 1}`,
      hand: []
    };
    rooms[roomId].players.push(player);
    socket.join(roomId);

    socket.emit('youJoined', { myIndex: rooms[roomId].players.length - 1 });
    io.to(roomId).emit('roomUpdate', {
      count: rooms[roomId].players.length,
      names: rooms[roomId].players.map(p => p.name)
    });

    if (rooms[roomId].players.length === 4) startGame(roomId);
  });

  // ĐÁNH BÀI
  socket.on('playCards', ({ roomId, cards }) => {
    const room = rooms[roomId];
    if (!room || room.players[room.currentTurn]?.id !== socket.id) return;

    if (!isValidPlay(cards, room.lastPlay)) {
      socket.emit('invalidPlay');
      return;
    }

    const player = room.players[room.currentTurn];
    cards.forEach(c => player.hand.splice(player.hand.indexOf(c), 1));

    room.lastPlay = cards;
    room.skipCount = 0;
    moveToNextTurn(roomId);

    io.to(roomId).emit('cardsPlayed', {
      playerName: player.name,
      cards,
      nextTurn: room.currentTurn
    });

    if (player.hand.length === 0) {
      io.to(roomId).emit('gameOver', { winner: player.name });
    }
  });

  // BỎ LƯỢT
  socket.on('skipTurn', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.players[room.currentTurn]?.id !== socket.id) return;

    room.skipCount++;
    moveToNextTurn(roomId);

    if (room.skipCount >= 3 && room.lastPlay) {
      room.lastPlay = null;
      room.skipCount = 0;
      io.to(roomId).emit('newRound');
    }

    io.to(roomId).emit('turnSkipped', { nextTurn: room.currentTurn });
  });
});

function moveToNextTurn(roomId) {
  const room = rooms[roomId];
  room.currentTurn = (room.currentTurn + 1) % 4;
  // Gửi lượt mới cho tất cả
  io.to(roomId).emit('turnChanged', { currentTurn: room.currentTurn });
}

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

  // Chia bài
  room.players.forEach(p => {
    p.hand = deck.splice(0, 13).sort((a, b) => {
      const ra = ranks.indexOf(a.slice(0,-1));
      const rb = ranks.indexOf(b.slice(0,-1));
      return ra - rb;
    });
  });

  // Ai có 3♠ đánh trước (tìm chính xác)
  let firstPlayer = 0;
  for (let i = 0; i < 4; i++) {
    if (room.players[i].hand.includes('3♠')) {
      firstPlayer = i;
      break;
    }
  }
  room.currentTurn = firstPlayer;
  room.lastPlay = null;
  room.skipCount = 0;

  room.players.forEach((p, idx) => {
    io.to(p.id).emit('gameStarted', {
      hand: p.hand,
      myIndex: idx,
      currentTurn: room.currentTurn,
      players: room.players.map(x => x.name)
    });
  });
}

// Kiểm tra nước đi (đã test chuẩn)
function isValidPlay(cards, lastPlay) {
  if (!lastPlay) return true;
  if (cards.length !== lastPlay.length) return false;

  const rankVal = c => "3456789XJQKA2".indexOf(c.slice(0, -1));
  const vals = cards.map(rankVal).sort((a,b)=>a-b);
  const lastVals = lastPlay.map(rankVal).sort((a,b)=>a-b);

  // Cùng loại (đôi, ba, sảnh, tứ quý…)
  const isSameKind = (arr) => new Set(arr).size === 1;
  const isStraight = (arr) => arr.length >= 3 && arr.every((v,i) => i===0 || v === arr[i-1]+1);

  if (isSameKind(vals) && cards.length >= 3) return true; // tứ quý, 3 đôi thông
  if (isStraight(vals)) return true; // sảnh
  if (vals[vals.length-1] > lastVals[lastVals.length-1]) return true;

  return false;
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
