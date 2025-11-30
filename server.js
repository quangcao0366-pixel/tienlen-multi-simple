const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static('public'));
const rooms = {};

io.on('connection', socket => {
  socket.on('joinRoom', ({roomId, playerName}) => {
    roomId = roomId || '123';
    if (!rooms[roomId]) rooms[roomId] = {players:[], ready:[], currentTurn:0, lastPlay:null, skipCount:0, gameCount:0, lastWinner:null};
    if (rooms[roomId].players.length >=4) return;

    const player = {id:socket.id, name:playerName||`Người ${rooms[roomId].players.length+1}`, hand:[]};
    rooms[roomId].players.push(player);
    socket.join(roomId);
    const myIndex = rooms[roomId].players.length-1;
    socket.emit('youJoined', {myIndex});

    updateRoom(roomId);

    // Auto start khi đủ 4 và tất cả ready
    if (rooms[roomId].players.length===4 && rooms[roomId].ready.length===4) startNewGame(roomId);
  });

  socket.on('toggleReady', roomId => {
    const room = rooms[roomId]; if(!room) return;
    const idx = room.players.findIndex(p=>p.id===socket.id);
    if(idx===-1) return;
    if(room.ready.includes(idx)) room.ready = room.ready.filter(i=>i!==idx);
    else room.ready.push(idx);
    updateRoom(roomId);
    if(room.players.length===4 && room.ready.length===4) startNewGame(roomId);
  });

  // các event playCards, skipTurn... giữ nguyên như file trước (đã hoạt động tốt)
  // (đoạn code playCards, skipTurn, moveToNextTurn, startNewGame, isValidPlay giữ nguyên 100% như lần trước mình gửi)
});

function updateRoom(roomId){
  const room = rooms[roomId];
  io.to(roomId).emit('roomUpdate', {
    count: room.players.length,
    names: room.players.map(p=>p.name),
    ready: room.ready
  });
}

// ... (giữ nguyên toàn bộ phần startNewGame, playCards, skipTurn, isValidPlay như file trước)

const PORT = process.env.PORT || 10000;
server.listen(PORT, ()=>console.log(`Server chạy mượt - port ${PORT}`));
