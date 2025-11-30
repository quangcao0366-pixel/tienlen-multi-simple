const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

const rooms = {};

// Giá trị lá bài và chất
const cardValues = { '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14,'2':15 };
const suitOrder = { 'S':1, 'C':2, 'D':3, 'H':4 };

// Tạo bộ bài 52 lá
function createDeck() {
  const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  const suits = ['S','C','D','H'];
  const deck = [];
  for (let r of ranks) for (let s of suits) deck.push(r + s);
  return deck.sort(() => Math.random() - 0.5);
}

// Sắp xếp bài trong tay người chơi
function cardValue(card) {
  const rank = card.slice(0, -1) === '10' ? '10' : card.slice(0, -1);
  const suit = card.slice(-1);
  return cardValues[rank] * 10 + suitOrder[suit];
}

// Kiểm tra nước bài hợp lệ
function isValidPlay(cards, lastPlay) {
  if (cards.length === 0) return false;
  if (!lastPlay || lastPlay.length === 0) return true;
  if (cards.length !== lastPlay.length) return false;

  const getType = arr => {
    if (arr.length === 1) return 'single';
    if (arr.every(c => cardValues[c.slice(0,-1)] === cardValues[arr[0].slice(0,-1)])) return 'pair';
    const vals = arr.map(c => cardValues[c.slice(0,-1)]).sort((a,b)=>a-b);
    if (vals.every((v,i)=> i===0 || v===vals[i-1]+1) && arr.length >= 3) return 'straight';
    return 'invalid';
  };

  const type1 = getType(cards);
  const type2 = getType(lastPlay);
  if (type1 !== type2) return false;

  const val1 = cardValues[cards[0].slice(0,-1)];
  const val2 = cardValues[lastPlay[0].slice(0,-1)];
  if (val1 > val2) return true;
  if (val1 === val2 && suitOrder[cards[0].slice(-1)] > suitOrder[lastPlay[0].slice(-1)]) return true;
  if (cards.some(c=>c.includes('2')) && !lastPlay.some(c=>c.includes('2'))) return true;
  return false;
}

io.on('connection', socket => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', ({roomId, playerName}) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        gameStarted: false,
        currentTurn: 0,
        playedCards: [],
        lastPlayedBy: null,
        skippedCount: 0,
        firstPlayer: 0
      };
    }

    const room = rooms[roomId];
    if (room.players.length >= 4 || room.gameStarted) {
      socket.emit('roomFull');
      return;
    }

    const player = { id: socket.id, name: playerName || 'Anh Em', hand: [], ready: false };
    room.players.push(player);

    socket.emit('youJoined', { myIndex: room.players.length - 1 });

    io.to(roomId).emit('roomUpdate', {
      names: room.players.map(p => p.name),
      ready: room.players.map((p,i) => p.ready ? i : -1).filter(x => x >= 0),
      count: room.players.length
    });
  });

  socket.on('toggleReady', ({roomId}) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.ready = !player.ready;
      io.to(roomId).emit('roomUpdate', {
        names: room.players.map(p => p.name),
        ready: room.players.map((p,i) => p.ready ? i : -1).filter(x => x >= 0),
        count: room.players.length
      });
    }
  });

  // BẮT ĐẦU VÁN – CHỈ NGƯỜI ĐẦU TIÊN ĐƯỢC BẤM
  socket.on('startGame', ({roomId}) => {
    const room = rooms[roomId];
    if (!room || room.players.length < 2 || room.gameStarted) return;
    const allReady = room.players.every(p => p.ready);
    if (!allReady || room.players[0].id !== socket.id) return;

    // CHIA ĐÚNG 13 LÁ/NGƯỜI – HOÀN TOÀN NGẪU NHIÊN
    room.gameStarted = true;
    room.currentTurn = 0;
    room.playedCards = [];
    room.lastPlayedBy = null;
    room.skippedCount = 0;

    const fullDeck = createDeck(); // 52 lá trộn ngẫu nhiên

    // Chia đều 13 lá cho từng người chơi
    room.players.forEach(player => {
      player.hand = fullDeck.splice(0, 13); // lấy 13 lá đầu tiên
      player.hand.sort(cardValue); // sắp xếp bài trong tay
    });

    // Tìm người có 3 bích để đánh trước
    for (let i = 0; i < room.players.length; i++) {
      if (room.players[i].hand.includes('3S')) {
        room.currentTurn = i;
        room.firstPlayer = i;
        break;
      }
    }

    // Gửi bài cho từng người chơi
    room.players.forEach((player, index) => {
      io.to(player.id).emit('gameStarted', {
        hand: player.hand,
        currentTurn: room.currentTurn
      });
    });

    // Gửi số lá bài còn lại cho tất cả
    io.to(roomId).emit('updateCardsLeft', {
      cardsLeft: room.players.map(p => p.hand.length)
    });
  });

  socket.on('playCards', ({roomId, cards}) => {
    const room = rooms[roomId];
    if (!room || !room.gameStarted) return;
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentTurn) return;

    if (!isValidPlay(cards, room.playedCards)) return;

    const player = room.players[playerIdx];
    player.hand = player.hand.filter(c => !cards.includes(c));
    room.playedCards = cards;
    room.lastPlayedBy = playerIdx;
    room.skippedCount = 0;

    io.to(roomId).emit('cardsPlayed', {cards, playerIndex: playerIdx});

    if (player.hand.length === 0) {
      io.to(roomId).emit('gameOver', {winner: player.name});
      room.gameStarted = false;
      room.players.forEach(p => p.ready = false);
      io.to(roomId).emit('roomUpdate', {
        names: room.players.map(p => p.name),
        ready: [],
        count: room.players.length
      });
      return;
    }

    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    io.to(roomId).emit('turnChanged', {currentTurn: room.currentTurn});
    io.to(roomId).emit('updateCardsLeft', {cardsLeft: room.players.map(p => p.hand.length)});
  });

  socket.on('skipTurn', ({roomId}) => {
    const room = rooms[roomId];
    if (!room || !room.gameStarted) return;
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentTurn) return;

    room.skippedCount++;
    if (room.skippedCount >= room.players.length - 1) {
      room.playedCards = [];
      room.skippedCount = 0;
    }

    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    io.to(roomId).emit('turnChanged', {currentTurn: room.currentTurn});
  });

  socket.on('leaveRoom', ({roomId}) => {
    if (!rooms[roomId]) return;
    rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
    if (rooms[roomId].players.length === 0) {
      delete rooms[roomId];
    } else {
      io.to(roomId).emit('roomUpdate', {
        names: rooms[roomId].players.map(p => p.name),
        ready: rooms[roomId].players.map((p,i) => p.ready ? i : -1).filter(x => x >= 0),
        count: rooms[roomId].players.length
      });
    }
    socket.leave(roomId);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (let rid in rooms) {
      rooms[rid].players = rooms[rid].players.filter(p => p.id !== socket.id);
      if (rooms[rid].players.length === 0) delete rooms[rid];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CHÍ DŨNG CLUB SERVER ĐANG CHẠY NGON TẠI PORT ${PORT}`);
  console.log(`Link: https://tienlen-multi-simple.onrender.com`);
});
