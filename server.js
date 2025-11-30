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
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        currentTurn: 0,
        lastPlay: null,
        skipCount: 0,
        gameCount: 0,        // đếm ván
        lastWinner: null     // người thắng ván trước
      };
    }

    if (rooms[roomId].players.length >= 4) {
      socket.emit('errorMsg', 'Phòng đầy!');
      return;
    }

    const player = {
  id: socket.id,
  name: playerName || `Người ${rooms[roomId].players.length + 1}`,
  hand: [],
  cardsLeft: 0   // <--- DÁN DÒNG NÀY VÀO ĐÂY
};
rooms[roomId].players.push(player);
    socket.join(roomId);

    socket.emit('youJoined', { myIndex: rooms[roomId].players.length - 1 });
    io.to(roomId).emit('roomUpdate', {
      count: rooms[roomId].players.length,
      names: rooms[roomId].players.map(p => p.name)
    });

    if (rooms[roomId].players.length === 4) startNewGame(roomId);
  });

  socket.on('playCards', ({ roomId, cards }) => {
    const room = rooms[roomId];
    if (!room || room.players[room.currentTurn]?.id !== socket.id) return;

    if (!isValidPlay(cards, room.lastPlay)) {
      socket.emit('invalidPlay');
      return;
    }

    // CẬP NHẬT SỐ BÀI CÒN LẠI + GỬI CHO TẤT CẢ CLIENT
room.players[room.currentTurn].cardsLeft = room.players[room.currentTurn].hand.length;
io.to(roomId).emit('updateCardsLeft', {
  cardsLeft: room.players.map(p => p ? p.cardsLeft : 13)
});

    room.lastPlay = cards;
    room.skipCount = 0;
    moveToNextTurn(roomId);

    io.to(roomId).emit('cardsPlayed', {
      playerName: player.name,
      cards,
      nextTurn: room.currentTurn
    });

    if (player.hand.length === 0) {
      room.lastWinner = room.currentTurn;
      room.gameCount++;
      io.to(roomId).emit('gameOver', { winner: player.name, winnerIndex: room.currentTurn });
      // Tự động bắt đầu ván mới sau 5s
      setTimeout(() => startNewGame(roomId), 5000);
    }
  });

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
  io.to(roomId).emit('turnChanged', { currentTurn: room.currentTurn });
}

function startNewGame(roomId) {
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
      const ra = ranks.indexOf(a.slice(0,-1));
      const rb = ranks.indexOf(b.slice(0,-1));
      return ra - rb;
    });
  });

  room.lastPlay = null;
  room.skipCount = 0;

  // === LUẬT CHUẨN: VÁN 1 = 3♠, CÁC VÁN SAU = NGƯỜI THẮNG VÁN TRƯỚC ===
  if (room.gameCount === 0) {
    // Ván đầu: tìm người có 3♠
    for (let i = 0; i < 4; i++) {
      if (room.players[i].hand.includes('3♠')) {
        room.currentTurn = i;
        break;
      }
      room.players.forEach(p => {
  if (p) p.cardsLeft = p.hand.length;
});
io.to(roomId).emit('updateCardsLeft', {
  cardsLeft: room.players.map(p => p ? p.cardsLeft : 13)
});
    }
  } else {
    // Các ván sau: người thắng ván trước đánh trước
    room.currentTurn = room.lastWinner;
  }

  room.players.forEach((p, idx) => {
    io.to(p.id).emit('gameStarted', {
      hand: p.hand,
      myIndex: idx,
      currentTurn: room.currentTurn,
      players: room.players.map(x => x.name),
      vanSo: room.gameCount + 1
    });
  });

  io.to(roomId).emit('newGameStarted', { vanSo: room.gameCount + 1 });
}

function isValidPlay(cards, lastPlay) {
  if (!lastPlay) return true;
  if (cards.length !== lastPlay.length) return false;

  const rankVal = c => "3456789XJQKA2".indexOf(c.slice(0, -1));
  const vals = cards.map(rankVal).sort((a,b)=>a-b);
  const lastVals = lastPlay.map(rankVal).sort((a,b)=>a-b);

  const isSameKind = arr => new Set(arr).size === 1;
  const isStraight = arr => arr.length >= 3 && arr.every((v,i) => i===0 || v === arr[i-1]+1);

  if (isSameKind(vals) && cards.length >= 3) return true;
  if (isStraight(vals)) return true;
  if (vals[vals.length-1] > lastVals[lastVals.length-1]) return true;

  return false;
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server Tiến Lên Miền Nam - Chuẩn luật 2025 running on port ${PORT}`));
