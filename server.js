const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static('public'));
const rooms = {};

io.on('connection', socket => {
  socket.on('joinRoom', ({ roomId, playerName }) => {
    roomId = roomId || '123';
    if (!rooms[roomId]) rooms[roomId] = { players: [], ready: [], currentTurn: 0, lastPlay: null, skipCount: 0, gameCount: 0, lastWinner: null };
    if (rooms[roomId].players.length >= 4) return socket.emit('errorMsg', 'Phòng đầy!');

    const player = { id: socket.id, name: playerName || `Người ${rooms[roomId].players.length+1}`, hand: [] };
    rooms[roomId].players.push(player);
    socket.join(roomId);
    const myIndex = rooms[roomId].players.length - 1;
    socket.emit('youJoined', { myIndex });

    io.to(roomId).emit('roomUpdate', {
      count: rooms[roomId].players.length,
      names: rooms[roomId].players.map(p => p.name),
      ready: rooms[roomId].ready
    });

    // Chỉ start khi đủ 4 người và tất cả ready
    if (rooms[roomId].players.length === 4 && rooms[roomId].ready.length === 4) {
      startNewGame(roomId);
    }
  });

  socket.on('toggleReady', roomId => {
    const room = rooms[roomId];
    if (!room) return;
    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx === -1) return;

    if (room.ready.includes(idx)) {
      room.ready = room.ready.filter(i => i !== idx);
    } else {
      room.ready.push(idx);
    }

    io.to(roomId).emit('roomUpdate', {
      count: room.players.length,
      names: room.players.map(p => p.name),
      ready: room.ready
    });

    if (room.players.length === 4 && room.ready.length === 4) {
      startNewGame(roomId);
    }
  });

  // playCards, skipTurn, moveToNextTurn, isValidPlay... giữ nguyên như cũ (đã fix trước đó)
  socket.on('playCards', ({ roomId, cards }) => {
    const room = rooms[roomId];
    if (!room || room.players[room.currentTurn]?.id !== socket.id) return;
    if (!isValidPlay(cards, room.lastPlay)) return socket.emit('invalidPlay');

    const player = room.players[room.currentTurn];
    player.hand = player.hand.filter(c => !cards.includes(c));

    const cardsLeft = room.players.map(p => p.hand.length);
    io.to(roomId).emit('updateCardsLeft', { cardsLeft });

    room.lastPlay = cards;
    room.skipCount = 0;

    io.to(roomId).emit('cardsPlayed', { playerIndex: room.currentTurn, cards });

    if (player.hand.length === 0) {
      room.lastWinner = room.currentTurn;
      room.gameCount++;
      io.to(roomId).emit('gameOver', { winner: player.name });
      setTimeout(() => startNewGame(roomId), 7000);
      return;
    }
    moveToNextTurn(roomId);
  });

  socket.on('skipTurn', roomId => {
    const room = rooms[roomId];
    if (!room || room.players[room.currentTurn]?.id !== socket.id) return;
    room.skipCount++;
    moveToNextTurn(roomId);
    if (room.skipCount >= 3 && room.lastPlay) {
      room.lastPlay = null; room.skipCount = 0;
      io.to(roomId).emit('newRound');
    }
  });
});

function moveToNextTurn(roomId) {
  const room = rooms[roomId];
  room.currentTurn = (room.currentTurn + 1) % 4;
  io.to(roomId).emit('turnChanged', { currentTurn: room.currentTurn });
}

function startNewGame(roomId) {
  const room = rooms[roomId];
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  let deck = [];
  for (let s of suits) for (let r of ranks) deck.push(r+s);
  for (let i=deck.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }

  room.players.forEach(p => {
    p.hand = deck.splice(0,13).sort((a,b) => {
      const ra = a.startsWith('10') ? '10' : a.slice(0,-1);
      const rb = b.startsWith('10') ? '10' : b.slice(0,-1);
      return ranks.indexOf(ra) - ranks.indexOf(rb);
    });
  });

  room.ready = []; room.lastPlay = null; room.skipCount = 0;
  if (room.gameCount === 0) {
    for (let i=0;i<4;i++) if (room.players[i].hand.includes('3♠')) { room.currentTurn = i; break; }
  } else room.currentTurn = room.lastWinner;

  const cardsLeft = room.players.map(p => p.hand.length);
  io.to(roomId).emit('updateCardsLeft', { cardsLeft });

  room.players.forEach((p,i) => {
    io.to(p.id).emit('gameStarted', { hand: p.hand, currentTurn: room.currentTurn });
  });
}

function isValidPlay(cards, lastPlay) {
  if (!lastPlay) return true;
  if (cards.length !== lastPlay.length) return false;
  const rankVal = c => "3456789XJQKA2".indexOf(c.slice(0,-1).replace('10','X'));
  const vals = cards.map(rankVal).sort((a,b)=>a-b);
  const lastVals = lastPlay.map(rankVal).sort((a,b)=>a-b);
  const same = arr => new Set(arr).size === 1;
  const straight = arr => arr.length >= 3 && arr.every((v,i)=>i===0||v===arr[i-1]+1);
  return same(vals) && cards.length >= 3 || straight(vals) || vals[vals.length-1] > lastVals[lastVals.length-1];
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Tiến Lên 4 Người Ready - Chạy mượt 100% trên port ${PORT}`));
