import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import usersModel from '../models/usersModel.js';
import { JWT_SECRET } from '../middleware/auth.js';
import { generateAssistantReply } from '../ai/chatAssistant.js';
import { getAllowedOrigins } from '../config/corsOrigins.js';
import { SOCKET_EVENTS } from './socketEvents.js';

const CHAT_EVENT = SOCKET_EVENTS.CHAT_MESSAGE;
const CANCEL_CHAT_EVENT = SOCKET_EVENTS.CANCEL_CHAT_MESSAGE;
const REPLY_EVENT = SOCKET_EVENTS.BOT_REPLY;
const ERROR_EVENT = SOCKET_EVENTS.CHAT_ERROR;
const ALLOW_DEBUG_ERRORS = process.env.ASSISTANT_DEBUG_ERRORS === 'true';
const SOCKET_DEBUG = process.env.SOCKET_DEBUG === 'true';
const CALL_INVITE_TTL_MS = 60 * 1000;

const userSockets = new Map();
const pendingCalls = new Map();
const AUTH_COOKIE_NAME = 'access_token';

const debugSocket = (...args) => {
  if (SOCKET_DEBUG) {
    console.log(...args);
  }
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const sanitizeForRoom = (value) =>
  value.replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const buildRoomName = (emailA, emailB) => {
  const pair = [normalizeEmail(emailA), normalizeEmail(emailB)].sort();
  const room = `bank11-${sanitizeForRoom(pair[0])}-${sanitizeForRoom(pair[1])}`;
  return room.slice(0, 120);
};
const emitToUser = (io, email, eventName, payload) => {
  const normalized = normalizeEmail(email);
  const sockets = userSockets.get(normalized);
  if (!sockets || sockets.size === 0) return 0;

  // Prune stale socket ids before emitting so "online" checks stay accurate.
  const liveSocketIds = [];
  sockets.forEach((socketId) => {
    if (io.sockets.sockets.has(socketId)) {
      liveSocketIds.push(socketId);
    }
  });

  if (liveSocketIds.length === 0) {
    userSockets.delete(normalized);
    return 0;
  }

  userSockets.set(normalized, new Set(liveSocketIds));
  liveSocketIds.forEach((socketId) => {
    io.to(socketId).emit(eventName, payload);
  });
  return liveSocketIds.length;
};
const clearPendingCall = (callId) => {
  if (!callId) return;
  pendingCalls.delete(callId);
};
const readTokenFromCookieHeader = (cookieHeader) => {
  const raw = String(cookieHeader || '');
  if (!raw) return null;
  const parts = raw.split(';');

  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=');
    if (key === AUTH_COOKIE_NAME) {
      return decodeURIComponent(rest.join('='));
    }
  }

  return null;
};

const normalizeTransferPayload = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  return {
    receiverEmail: typeof value.receiverEmail === 'string' ? value.receiverEmail : null,
    amount: value.amount ?? null,
    description: typeof value.description === 'string' ? value.description : null,
    confirmation: ['yes', 'no'].includes(value.confirmation) ? value.confirmation : null,
    skipDescription: Boolean(value.skipDescription),
    startNewTransfer: Boolean(value.startNewTransfer)
  };
};
const isActiveTransferState = (state = null) => {
  const phase = state?.phase;
  return Boolean(phase && phase !== 'idle');
};
const hasMeaningfulTransferPayload = (payload = null) => Boolean(
  payload
    && (
      payload.receiverEmail
      || payload.amount
      || payload.description
      || payload.confirmation
      || payload.skipDescription
      || payload.startNewTransfer
    )
);

export const initSocketServer = (httpServer) => {
  debugSocket('INIT SOCKET SERVER CALLED');

  const io = new Server(httpServer, {
    cors: {
      origin: getAllowedOrigins(),
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const authToken = socket.handshake?.auth?.token;
      const cookieToken = readTokenFromCookieHeader(socket.handshake?.headers?.cookie);
      debugSocket('SOCKET AUTH START', {
        hasAuthToken: Boolean(authToken),
        hasCookieToken: Boolean(cookieToken),
        origin: socket.handshake?.headers?.origin || null
      });

      const token =
        authToken ||
        cookieToken;
      if (!token) {
        debugSocket('SOCKET AUTH FAILED', { reason: 'missing_token' });
        return next(new Error('Unauthorized'));
      }

      const payload = jwt.verify(token, JWT_SECRET);
      const user = await usersModel.findUserById(payload.userId);
      const tokenVersionFromJwt = Number(payload?.tokenVersion || 0);
      const tokenVersionFromDb = Number(user?.tokenVersion || 0);

      if (!user || !user.isVerified || tokenVersionFromJwt !== tokenVersionFromDb) {
        debugSocket('SOCKET AUTH FAILED', { reason: 'invalid_user_or_session' });
        return next(new Error('Unauthorized'));
      }

      socket.user = {
        id: String(user._id),
        email: user.email,
        firstName: user.firstName
      };
      debugSocket('SOCKET AUTH SUCCESS', { userId: socket.user.id });
      next();
    } catch {
      debugSocket('SOCKET AUTH FAILED', { reason: 'token_verification' });
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    let history = [];
    let transferState = null;
    const activeAssistantRequests = new Map();
    const normalizedEmail = normalizeEmail(socket.user.email);
    const userSet = userSockets.get(normalizedEmail) || new Set();
    userSet.add(socket.id);
    userSockets.set(normalizedEmail, userSet);
    debugSocket('SOCKET CONNECTED', { socketId: socket.id, userId: socket.user.id });

    socket.onAny((eventName) => {
      debugSocket('SERVER GOT ANY EVENT', { eventName, socketId: socket.id });
    });

    socket.on(CHAT_EVENT, async (payload) => {
      debugSocket('SERVER GOT chat_message', {
        requestId: payload?.requestId || null,
        hasMessage: Boolean(payload?.message),
        hasTransferPayload: Boolean(payload?.transferPayload)
      });
      const requestId = String(payload?.requestId || Date.now());
      const controller = new AbortController();
      activeAssistantRequests.set(requestId, controller);

      try {
        const text = String(payload?.message || '').trim();
        if (!text) {
          socket.emit(ERROR_EVENT, {
            requestId,
            message: 'Message is required'
          });
          activeAssistantRequests.delete(requestId);
          return;
        }

        if (text.length > 2000) {
          socket.emit(ERROR_EVENT, {
            requestId,
            message: 'Message is too long'
          });
          activeAssistantRequests.delete(requestId);
          return;
        }

        const transferPayload = normalizeTransferPayload(payload?.transferPayload);
        if (isActiveTransferState(transferState) && !hasMeaningfulTransferPayload(transferPayload)) {
          socket.emit(ERROR_EVENT, {
            requestId,
            message: 'Complete the current workflow before sending another chat message.'
          });
          activeAssistantRequests.delete(requestId);
          return;
        }

        const { reply, nextHistory, nextTransferState, action } = await generateAssistantReply({
          userInput: text,
          userId: socket.user.id,
          userEmail: normalizedEmail,
          history,
          transferState,
          transferPayload,
          abortSignal: controller.signal
        });

        if (controller.signal.aborted) {
          activeAssistantRequests.delete(requestId);
          return;
        }

        history = nextHistory;
        transferState = nextTransferState || null;
        socket.emit(REPLY_EVENT, {
          requestId,
          message: reply,
          action: action || null,
          nextTransferState: transferState
        });
        debugSocket('SERVER SENT bot_reply', {
          requestId,
          hasAction: Boolean(action),
          hasNextTransferState: Boolean(transferState)
        });
        activeAssistantRequests.delete(requestId);
      } catch (err) {
        const details = String(err?.message || err);
        if (controller.signal.aborted || details.toLowerCase().includes('abort')) {
          activeAssistantRequests.delete(requestId);
          return;
        }
        socket.emit(ERROR_EVENT, {
          requestId,
          message:
            process.env.NODE_ENV === 'production' && !ALLOW_DEBUG_ERRORS
              ? 'Assistant is temporarily unavailable'
              : `Assistant error: ${details}`
        });
        debugSocket('SERVER SENT chat_error', { requestId });
        console.error('Socket assistant error:', details);
        activeAssistantRequests.delete(requestId);
      }
    });

    socket.on(CANCEL_CHAT_EVENT, (payload) => {
      const requestId = String(payload?.requestId || '');
      if (!requestId) return;
      const controller = activeAssistantRequests.get(requestId);
      if (!controller) return;
      controller.abort();
      activeAssistantRequests.delete(requestId);
    });

    socket.on('call_request', async (payload, ack) => {
      const acknowledge = typeof ack === 'function' ? ack : () => {};
      try {
        const toEmail = normalizeEmail(payload?.toEmail);
        const fromEmail = normalizedEmail;

        if (!toEmail || !toEmail.includes('@')) {
          acknowledge({ ok: false, message: 'Invalid recipient email' });
          return;
        }

        if (toEmail === fromEmail) {
          acknowledge({ ok: false, message: 'Cannot call your own email' });
          return;
        }

        const recipient = await usersModel.findVerifiedUserByEmail(toEmail);
        if (!recipient) {
          acknowledge({ ok: false, message: 'Recipient not found or not verified' });
          return;
        }

        const callId = `${Date.now()}-${socket.id}-${Math.random().toString(36).slice(2, 8)}`;
        const roomName = buildRoomName(fromEmail, toEmail);
        const deliveredTo = emitToUser(io, toEmail, 'call_incoming', {
          callId,
          fromEmail,
          fromName: socket.user.firstName,
          roomName,
          createdAt: new Date().toISOString()
        });

        if (deliveredTo === 0) {
          acknowledge({ ok: false, message: 'Recipient is offline right now' });
          return;
        }

        const callPayload = {
          callId,
          roomName,
          fromEmail,
          toEmail,
          createdAt: Date.now(),
          fromName: socket.user.firstName,
          status: 'pending'
        };
        pendingCalls.set(callId, callPayload);

        acknowledge({
          ok: true,
          callId,
          roomName,
          toEmail
        });

        setTimeout(() => {
          const current = pendingCalls.get(callId);
          if (!current || current.status !== 'pending') return;
          pendingCalls.delete(callId);
          emitToUser(io, fromEmail, 'call_timeout', {
            callId,
            toEmail,
            message: 'Call was not answered'
          });
          emitToUser(io, toEmail, 'call_canceled', {
            callId,
            fromEmail
          });
        }, CALL_INVITE_TTL_MS);
      } catch {
        acknowledge({ ok: false, message: 'Could not start the call' });
      }
    });

    socket.on('call_accept', (payload, ack) => {
      const acknowledge = typeof ack === 'function' ? ack : () => {};
      const callId = String(payload?.callId || '');
      const call = pendingCalls.get(callId);

      if (!call || call.status !== 'pending') {
        acknowledge({ ok: false, message: 'Call is no longer available' });
        return;
      }

      if (normalizeEmail(call.toEmail) !== normalizedEmail) {
        acknowledge({ ok: false, message: 'Not authorized for this call' });
        return;
      }

      emitToUser(io, call.fromEmail, 'call_accepted', {
        callId,
        roomName: call.roomName,
        peerEmail: call.toEmail
      });
      emitToUser(io, call.toEmail, 'call_accepted', {
        callId,
        roomName: call.roomName,
        peerEmail: call.fromEmail
      });

      acknowledge({
        ok: true,
        callId,
        roomName: call.roomName,
        peerEmail: call.fromEmail
      });
      clearPendingCall(callId);
    });

    socket.on('call_decline', (payload) => {
      const callId = String(payload?.callId || '');
      const call = pendingCalls.get(callId);
      if (!call || call.status !== 'pending') return;
      if (normalizeEmail(call.toEmail) !== normalizedEmail) return;

      call.status = 'declined';
      pendingCalls.set(callId, call);

      emitToUser(io, call.fromEmail, 'call_declined', {
        callId,
        byEmail: call.toEmail
      });
      emitToUser(io, call.toEmail, 'call_canceled', {
        callId,
        fromEmail: call.fromEmail
      });
      clearPendingCall(callId);
    });

    socket.on('call_cancel', (payload) => {
      const callId = String(payload?.callId || '');
      const call = pendingCalls.get(callId);
      if (!call || call.status !== 'pending') return;
      if (normalizeEmail(call.fromEmail) !== normalizedEmail) return;

      call.status = 'canceled';
      pendingCalls.set(callId, call);
      emitToUser(io, call.toEmail, 'call_canceled', {
        callId,
        fromEmail: call.fromEmail
      });
      clearPendingCall(callId);
    });

    socket.on('disconnect', () => {
      history = [];
      activeAssistantRequests.forEach((controller) => {
        try {
          controller.abort();
        } catch {}
      });
      activeAssistantRequests.clear();

      const sockets = userSockets.get(normalizedEmail);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(normalizedEmail);
        } else {
          userSockets.set(normalizedEmail, sockets);
        }
      }

      pendingCalls.forEach((call, callId) => {
        if (call.status !== 'pending') {
          clearPendingCall(callId);
          return;
        }

        if (normalizeEmail(call.fromEmail) === normalizedEmail) {
          emitToUser(io, call.toEmail, 'call_canceled', {
            callId,
            fromEmail: call.fromEmail
          });
          clearPendingCall(callId);
        }
      });
    });
  });

  return io;
};
