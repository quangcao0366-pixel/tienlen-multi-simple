// ... phần đầu file giữ nguyên

io.on('connection', socket => {
  socket.on('joinRoom', ({roomId, playerName}) => {
    roomId = roomId || '123';
    if (!rooms[roomId]) rooms[roomId] = {players:[], ready:[], currentTurn:0, lastPlay:null, skipCount:0, gameCount:0, lastWinner:null};
    if (rooms[roomId].players.length >=4) return socket.emit('roomUpdate',{count:4}); // phòng đầy

    const player = {id:socket.id, name:playerName||`Người ${rooms[roomId].players.length+1}`, hand:[]};
    rooms[roomId].players.push(player);
    socket.join(roomId);
    const myIndex = rooms[roomId].players.length-1;
    socket.emit('youJoined', {myIndex});

    broadcastRoomUpdate(roomId);

    if (rooms[roomId].players.length===4 && rooms[roomId].ready.length===4) startNewGame(roomId);
  });

  socket.on('toggleReady', roomId => {
    const room = rooms[roomId];
    if (!room) return;
    const idx = room.players.findIndex(p => p.id===socket.id);
    if (idx===-1) return;

    const pos = room.ready.indexOf(idx);
    if (pos>-1) room.ready.splice(pos,1);
    else room.ready.push(idx);

    broadcastRoomUpdate(roomId);

    if (room.players.length===4 && room.ready.length===4) {
      setTimeout(()=>startNewGame(roomId), 800); // cho client thấy hiệu ứng đẹp
    }
  });

  // các event playCards, skipTurn, startNewGame, isValidPlay... giữ nguyên 100% như file trước
});

function broadcastRoomUpdate(roomId){
  const room = rooms[roomId];
  io.to(roomId).emit('roomUpdate', {
    count: room.players.length,
    names: room.players.map(p=>p.name),
    ready: room.ready
  });
}
