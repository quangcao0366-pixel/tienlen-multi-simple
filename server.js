const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

const rooms = {};

// === GIÁ TRỊ LÁ BÀI & CHẤT (DÙNG ĐỂ SẮP XẾP CHUẨN) ===
const rankValue = { '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14,'2':15 };
const suitValue = { 'S':1, 'C':2, 'D':3, 'H':4 }; // ♠♣♦♥

function createDeck() {
  const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  const suits = ['S','C','D','H'];
  const deck = [];
  for (let r of ranks) for (let s of suits) deck.push(r + s);
  return deck.sort(() => Math.random() - 0.5);
}

// HÀM SẮP XẾP BÀI ĐẸP NHẤT: từ nhỏ → lớn, cùng giá trị thì theo chất ♠♣♦♥
function sortHand(hand) {
  return hand.sort((a, b) => {
    const rankA = rankValue[a.slice(0, -1)];
    const rankB = rankValue[b.slice(0, -1)];
    if (rankA !== rankB) return rankA - rankB;
    return suitValue[a.slice(-1)] - suitValue[b.slice(-1)];
  });
}

// Kiểm tra nước bài hợp lệ (giữ nguyên, đã chuẩn)
function isValidPlay(cards, lastPlay) {
  if (cards.length === 0) return false;
  if (!lastPlay || lastPlay.length === 0) return true;
  if (cards.length !== lastPlay.length) return false;

  const getType = arr => {
    if (arr.length === 1) return 'single';
    const firstRank = arr[0].slice(0, -1);
    if (arr.every(c => c.slice(0, -1) === firstRank)) return 'pair';
    const vals = arr.map(c => rankValue[c.slice(0, -1)]).sort((a,b)=>a-b);
    if (vals.every((v,i)=> i===0 || v===vals[i-1]+1) && arr.length >= 3) return 'straight';
    return 'invalid';
  };

  const type1 = getType(cards);
  const type2 = getType(lastPlay);
  if (type1 !== type2) return false;

  const val1 = rankValue[cards[0].slice(0, -1)];
  const val2 = rankValue[lastPlay[0].slice(0, -1)];
  if (val1 > val2) return true;
  if (val1 === val2 && suitValue[cards[0].slice(-1)] > suitValue[lastPlay[0].slice(-1)]) return true;
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

  // BẮT ĐẦU VÁN – CHIA 13 LÁ + TỰ ĐỘNG SẮP XẾP ĐẸP
  socket.on('startGame', ({roomId}) => {
    const room = rooms[roomId];
    if (!room || room.players.length < 2 || room.gameStarted) return;
    const allReady = room.players.every(p => p.ready);
    if (!allReady || room.players[0].id !== socket.id) return;

    room.gameStarted = true;
    room.currentTurn = 0;
    room.playedCards = [];
    room.lastPlayedBy = null;
    room.skippedCount = 0;

    const fullDeck = createDeck(); // 52 lá trộn ngẫu nhiên

    // Chia 13 lá cho từng người + sắp xếp ngay lập tức
    room.players.forEach(player => {
      player.hand = fullDeck.splice(0, 13);
      player.hand = sortHand(player.hand); // SẮP XẾP TỪ NHỎ → LỚN, SIÊU ĐẸP
    });

    // Tìm người có 3 bích
    for (let i = 0; i < room.players.length; i++) {
      if (room.players[i].hand.includes('3S')) {
        room.currentTurn = i;
        room.firstPlayer = i;
        break;
      }
    }

    // Gửi bài đã sắp xếp cho từng người
    room.players.forEach(player => {
      io.to(player.id).emit('gameStarted', {
        hand: player.hand,
        currentTurn: room.currentTurn
      });
    });

    io.to(roomId).emit('updateCardsLeft', {
      cardsLeft: room.players.map(p => p.hand.length)
    });
  });

  // === CÁC HÀM CHƠI BÀI (giữ nguyên, đã test ổn định) ===
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
      io.to(roomId).emit('roomUpdate', {names: room.players.map(p=>p.name), ready: [], count: room.players.length});
      return;
    }

    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    io.to(roomId).emit('turnChanged', {currentTurn: room.currentTurn});
    io.to(roomId).emit('updateCardsLeft', {cardsLeft: room.players.map(p=>p.hand.length)});
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
    if (rooms[roomId].players.length === 0) delete rooms[roomId];
    else io.to(roomId).emit('roomUpdate', {
      names: rooms[roomId].players.map(p=>p.name),
      ready: rooms[roomId].players.map((p,i)=>p.ready?i:-1).filter(x=>x>=0),
      count: rooms[roomId].players.length
    });
    socket.leave(roomId);
  });

  socket.on('disconnect', () => {
    for (let rid in rooms) {
      rooms[rid].players = rooms[rid].players.filter(p => p.id !== socket.id);
      if (rooms[rid].players.length === 0) delete rooms[rid];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CHÍ DŨNG CLUB SERVER CHẠY NGON LÀNH TẠI PORT ${PORT}`);
  console.log(`Link chơi: https://tienlen-multi-simple.onrender.com`);
});
