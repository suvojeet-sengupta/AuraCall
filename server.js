const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for SPA routing if needed
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Track active users and rooms
// Format: { socketId: { roomId, username } }
const users = {};
// Format: { roomId: [socketId1, socketId2, ...] }
const rooms = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle joining a room
  socket.on('join-room', ({ roomId, username, mediaState }) => {
    // Validate inputs
    if (!roomId || !username) {
      socket.emit('error-message', 'Room ID and Username are required.');
      return;
    }

    // Standardize roomId
    const cleanRoomId = roomId.trim().toLowerCase();
    const cleanUsername = username.trim();

    console.log(`${cleanUsername} (${socket.id}) is joining room: ${cleanRoomId}`);

    // Store user information, including current media state (mute, video, screen)
    users[socket.id] = { 
      roomId: cleanRoomId, 
      username: cleanUsername,
      mediaState: mediaState || { audio: true, video: true, screen: false }
    };

    // Initialize room if it doesn't exist
    if (!rooms[cleanRoomId]) {
      rooms[cleanRoomId] = [];
    }

    // Prevent duplicate entries in the same room
    if (!rooms[cleanRoomId].includes(socket.id)) {
      rooms[cleanRoomId].push(socket.id);
    }

    // Join the socket.io room room channel
    socket.join(cleanRoomId);

    // Get list of other users in the room
    const otherUsers = rooms[cleanRoomId]
      .filter(id => id !== socket.id)
      .map(id => ({
        socketId: id,
        username: users[id]?.username || 'Unknown Peer',
        mediaState: users[id]?.mediaState || { audio: true, video: true, screen: false }
      }));

    // Tell the new user about the existing users in the room
    socket.emit('room-users', {
      roomId: cleanRoomId,
      users: otherUsers
    });

    // Notify other users in the room that a new user has joined
    socket.to(cleanRoomId).emit('user-joined', {
      socketId: socket.id,
      username: cleanUsername,
      mediaState: users[socket.id].mediaState
    });
  });

  // Relay signaling data (offer, answer, ICE candidate) to a specific user
  socket.on('signal', ({ targetSocketId, signalData }) => {
    if (!users[socket.id]) return; // User not in room

    const signalType = signalData.sdp ? signalData.sdp.type : (signalData.candidate ? 'ICE-candidate' : 'unknown');
    console.log(`[SIGNAL] Relaying [${signalType}] from ${users[socket.id].username} (${socket.id}) to target: ${targetSocketId}`);

    // Forward the signal to the target user with the sender's details
    io.to(targetSocketId).emit('signal', {
      senderSocketId: socket.id,
      senderUsername: users[socket.id].username,
      signalData
    });
  });

  // Handle media toggling via websocket (mute, camera off, screen share)
  socket.on('toggle-media', ({ type, enabled }) => {
    const user = users[socket.id];
    if (!user) return;

    if (!user.mediaState) {
      user.mediaState = { audio: true, video: true, screen: false };
    }

    // Update server side state
    user.mediaState[type] = enabled;

    console.log(`Media toggle: ${user.username} (${socket.id}) toggled ${type} to ${enabled}`);

    // Broadcast state toggle to all other peers in the room
    socket.to(user.roomId).emit('peer-media-toggled', {
      socketId: socket.id,
      type,
      enabled
    });
  });

  // Handle client-side errors for remote debugging
  socket.on('client-error', (errorDetails) => {
    console.error(`[CLIENT ERROR] from socket ${socket.id}:`, errorDetails);
  });

  // Handle text chat messages
  socket.on('send-message', (messageText) => {
    const user = users[socket.id];
    if (!user) return;

    // Broadcast message to everyone in the room (including sender)
    io.to(user.roomId).emit('receive-message', {
      senderSocketId: socket.id,
      senderUsername: user.username,
      text: messageText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // Handle emoji reactions
  socket.on('send-reaction', (emoji) => {
    const user = users[socket.id];
    if (!user) return;
    
    socket.to(user.roomId).emit('peer-reaction', {
      socketId: socket.id,
      emoji
    });
  });

  // Handle live speech captions
  socket.on('send-caption', (text) => {
    const user = users[socket.id];
    if (!user) return;
    
    socket.to(user.roomId).emit('peer-caption', {
      socketId: socket.id,
      text
    });
  });

  // Handle hand raises
  socket.on('raise-hand', (isRaised) => {
    const user = users[socket.id];
    if (!user) return;
    
    socket.to(user.roomId).emit('peer-raised-hand', {
      socketId: socket.id,
      isRaised
    });
  });

  // Handle local video filter changes
  socket.on('change-filter', (filterClass) => {
    const user = users[socket.id];
    if (!user) return;

    // Update user local filter state
    user.filterClass = filterClass;
    
    socket.to(user.roomId).emit('peer-filter-changed', {
      socketId: socket.id,
      filterClass
    });
  });

  // Handle leaving the room explicitly
  socket.on('leave-room', () => {
    handleUserDisconnect(socket);
  });

  // Handle connection drop
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    handleUserDisconnect(socket);
  });
});

function handleUserDisconnect(socket) {
  const user = users[socket.id];
  if (!user) return;

  const { roomId, username } = user;
  console.log(`${username} (${socket.id}) left room: ${roomId}`);

  // Remove from users list
  delete users[socket.id];

  // Remove from room list
  if (rooms[roomId]) {
    rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
    
    // Clean up empty room
    if (rooms[roomId].length === 0) {
      delete rooms[roomId];
    }
  }

  // Notify remaining users in the room
  socket.to(roomId).emit('user-left', {
    socketId: socket.id,
    username
  });

  // Leave socket.io channel
  socket.leave(roomId);
}

let port = process.env.PORT || 3000;

function startServer() {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying ${port + 1}...`);
      port++;
      startServer();
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Signaling server running on port ${port}`);
  });
}

startServer();

