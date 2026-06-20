import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

const port = parseInt(process.env.PORT || '3001', 10);

interface UserMediaState {
  audio: boolean;
  video: boolean;
  screen: boolean;
}

interface UserInfo {
  roomId: string;
  username: string;
  mediaState: UserMediaState;
  filterClass?: string;
}

const users: Record<string, UserInfo> = {};
const rooms: Record<string, string[]> = {};

nextApp.prepare().then(() => {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket: Socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join-room', ({ roomId, username, mediaState }: { roomId: string; username: string; mediaState?: UserMediaState }) => {
      if (!roomId || !username) {
        socket.emit('error-message', 'Room ID and Username are required.');
        return;
      }

      const cleanRoomId = roomId.trim().toLowerCase();
      const cleanUsername = username.trim();

      console.log(`${cleanUsername} (${socket.id}) is joining room: ${cleanRoomId}`);

      users[socket.id] = {
        roomId: cleanRoomId,
        username: cleanUsername,
        mediaState: mediaState || { audio: false, video: false, screen: false }
      };

      if (!rooms[cleanRoomId]) {
        rooms[cleanRoomId] = [];
      }

      if (!rooms[cleanRoomId].includes(socket.id)) {
        rooms[cleanRoomId].push(socket.id);
      }

      socket.join(cleanRoomId);

      const otherUsers = rooms[cleanRoomId]
        .filter(id => id !== socket.id)
        .map(id => ({
          socketId: id,
          username: users[id]?.username || 'Unknown Peer',
          mediaState: users[id]?.mediaState || { audio: false, video: false, screen: false }
        }));

      socket.emit('room-users', {
        roomId: cleanRoomId,
        users: otherUsers
      });

      socket.to(cleanRoomId).emit('user-joined', {
        socketId: socket.id,
        username: cleanUsername,
        mediaState: users[socket.id].mediaState
      });
    });

    socket.on('signal', ({ targetSocketId, signalData }: { targetSocketId: string; signalData: any }) => {
      if (!users[socket.id]) return;

      const signalType = signalData.sdp ? signalData.sdp.type : (signalData.candidate ? 'ICE-candidate' : 'unknown');
      console.log(`[SIGNAL] Relaying [${signalType}] from ${users[socket.id].username} (${socket.id}) to target: ${targetSocketId}`);

      io.to(targetSocketId).emit('signal', {
        senderSocketId: socket.id,
        senderUsername: users[socket.id].username,
        signalData
      });
    });

    socket.on('toggle-media', ({ type, enabled }: { type: 'audio' | 'video' | 'screen'; enabled: boolean }) => {
      const user = users[socket.id];
      if (!user) return;

      user.mediaState[type] = enabled;
      console.log(`Media toggle: ${user.username} (${socket.id}) toggled ${type} to ${enabled}`);

      socket.to(user.roomId).emit('peer-media-toggled', {
        socketId: socket.id,
        type,
        enabled
      });
    });

    socket.on('send-message', (messageText: string) => {
      const user = users[socket.id];
      if (!user) return;

      console.log(`[CHAT] ${user.username} in room ${user.roomId}: ${messageText}`);

      io.to(user.roomId).emit('receive-message', {
        senderSocketId: socket.id,
        senderUsername: user.username,
        text: messageText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    });

    socket.on('send-reaction', (emoji: string) => {
      const user = users[socket.id];
      if (!user) return;

      console.log(`[REACTION] ${user.username} sent reaction: ${emoji}`);

      socket.to(user.roomId).emit('peer-reaction', {
        socketId: socket.id,
        emoji
      });
    });

    socket.on('send-caption', (text: string) => {
      const user = users[socket.id];
      if (!user) return;

      socket.to(user.roomId).emit('peer-caption', {
        socketId: socket.id,
        text
      });
    });

    socket.on('raise-hand', (isRaised: boolean) => {
      const user = users[socket.id];
      if (!user) return;

      console.log(`[HAND-RAISE] ${user.username} raised hand: ${isRaised}`);

      socket.to(user.roomId).emit('peer-raised-hand', {
        socketId: socket.id,
        isRaised
      });
    });

    socket.on('change-filter', (filterClass: string) => {
      const user = users[socket.id];
      if (!user) return;

      user.filterClass = filterClass;
      console.log(`[FILTER] ${user.username} set filter to ${filterClass}`);

      socket.to(user.roomId).emit('peer-filter-changed', {
        socketId: socket.id,
        filterClass
      });
    });

    socket.on('disconnect', () => {
      const user = users[socket.id];
      if (!user) {
        console.log(`Unregistered user disconnected: ${socket.id}`);
        return;
      }

      console.log(`${user.username} (${socket.id}) disconnected`);

      const { roomId, username } = user;
      delete users[socket.id];

      if (rooms[roomId]) {
        rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
        if (rooms[roomId].length === 0) {
          delete rooms[roomId];
          console.log(`Room is empty, cleaning up: ${roomId}`);
        }
      }

      socket.to(roomId).emit('user-left', {
        socketId: socket.id,
        username
      });
    });
  });

  // Next.js request fallback handler
  app.all('*all', (req, res) => {
    return handle(req, res);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`> Ready and signaling server running on http://localhost:${port}`);
  });
});
