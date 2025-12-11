import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

/* eslint-disable @typescript-eslint/no-explicit-any */
const app = express();
dotenv.config();
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
console.log(process.env.CLIENT_ORIGIN);

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN,
    credentials: true,
  },
});

// In-memory presence map: userId -> number of active sockets
const onlineUsers = new Map<string, number>();

// Socket.IO auth using NextAuth JWT
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    return next(new Error('No token provided'));
  }

  try {
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET!);
    const userId = (decoded as any).sub;
    if (!userId) {
      return next(new Error('Invalid token'));
    }
    (socket as any).userId = userId;
    next();
  } catch (err) {
    next(new Error(`Invalid token: ${err}`));
  }
});

io.on('connection', (socket) => {
  const userId = (socket as any).userId as string;
  if (!userId) return;

  socket.join(`user:${userId}`);

  // increment presence count
  const prev = onlineUsers.get(userId) ?? 0;
  onlineUsers.set(userId, prev + 1);

  if (prev === 0) {
    io.emit('presence:update', { userId, online: true });
  }

  console.log(
    `User ${userId} connected. Connections: ${onlineUsers.get(userId)}`,
  );

  socket.on('disconnect', () => {
    const prev = onlineUsers.get(userId) ?? 0;
    const next = Math.max(0, prev - 1);
    if (next === 0) {
      onlineUsers.delete(userId);
      io.emit('presence:update', { userId, online: false });
    } else {
      onlineUsers.set(userId, next);
    }
    console.log(`User ${userId} disconnected. Connections: ${next}`);
    setInterval(() => {
      console.log('Users online: ', onlineUsers);
    }, 5000);
  });
});

// Simple health route
app.get('/', (_req, res) => {
  res.send('WebSocket server running');
});

app.post('/notify-message', express.json(), (req, res) => {
  const { conversationId, message, recipients } = req.body as {
    conversationId: string;
    message: any;
    recipients: string[];
  };

  if (!conversationId || !message || !Array.isArray(recipients)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  for (const userId of recipients) {
    io.to(`user:${userId}`).emit('message:new', {
      conversationId,
      message,
    });
  }

  return res.json({ ok: true });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Socket.IO server listening on port ${PORT}`);
});
/* eslint-enable @typescript-eslint/no-explicit-any */
