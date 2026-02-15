import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import usersModel from '../models/usersModel.js';
import { JWT_SECRET } from '../middleware/auth.js';
import { generateAssistantReply } from '../ai/chatAssistant.js';

const CHAT_EVENT = 'chat_message';
const REPLY_EVENT = 'bot_reply';
const ERROR_EVENT = 'chat_error';

const getOrigins = () => {
  if (process.env.SOCKET_CORS_ORIGINS) {
    return process.env.SOCKET_CORS_ORIGINS.split(',').map((v) => v.trim());
  }

  return [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://bank-11-frontend.vercel.app'
  ];
};

export const initSocketServer = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: getOrigins(),
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake?.auth?.token;
      if (!token) {
        return next(new Error('Unauthorized'));
      }

      const payload = jwt.verify(token, JWT_SECRET);
      const user = await usersModel.findUserById(payload.userId);

      if (!user || !user.isVerified) {
        return next(new Error('Unauthorized'));
      }

      socket.user = {
        id: String(user._id),
        email: user.email,
        firstName: user.firstName
      };
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    let history = [];

    socket.on(CHAT_EVENT, async (payload) => {
      try {
        const text = String(payload?.message || '').trim();
        if (!text) {
          socket.emit(ERROR_EVENT, {
            message: 'Message is required'
          });
          return;
        }

        if (text.length > 2000) {
          socket.emit(ERROR_EVENT, {
            message: 'Message is too long'
          });
          return;
        }

        const { reply, nextHistory } = await generateAssistantReply({
          userInput: text,
          userId: socket.user.id,
          history
        });

        history = nextHistory;
        socket.emit(REPLY_EVENT, { message: reply });
      } catch (err) {
        socket.emit(ERROR_EVENT, {
          message: 'Assistant is temporarily unavailable'
        });
        console.error('Socket assistant error:', err?.message || err);
      }
    });

    socket.on('disconnect', () => {
      history = [];
    });
  });

  return io;
};
