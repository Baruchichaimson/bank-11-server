import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllowedOrigins } from '../config/corsOrigins.js';
import { SOCKET_EVENTS as BACKEND_SOCKET_EVENTS } from '../socket/socketEvents.js';
import { SOCKET_EVENTS as FRONTEND_SOCKET_EVENTS } from '../../bank-frontend/api/socketEvents.js';
import {
  SOCKET_TRANSPORTS,
  normalizeSocketUrl
} from '../../bank-frontend/api/socket.js';

test('backend and frontend chat socket event constants match', () => {
  assert.deepEqual(FRONTEND_SOCKET_EVENTS, BACKEND_SOCKET_EVENTS);
  assert.equal(BACKEND_SOCKET_EVENTS.CHAT_MESSAGE, 'chat_message');
  assert.equal(BACKEND_SOCKET_EVENTS.BOT_REPLY, 'bot_reply');
  assert.equal(BACKEND_SOCKET_EVENTS.CHAT_ERROR, 'chat_error');
});

test('frontend socket transport config allows polling fallback before websocket upgrade', () => {
  assert.deepEqual([...SOCKET_TRANSPORTS], ['polling', 'websocket']);
});

test('frontend socket URL normalization strips API paths from configured URLs', () => {
  assert.equal(
    normalizeSocketUrl('https://api.example.com/api/v1'),
    'https://api.example.com'
  );
});

test('Socket.IO CORS defaults allow local Vite localhost and 127.0.0.1 origins', () => {
  const origins = getAllowedOrigins();

  assert.ok(origins.includes('http://localhost:5173'));
  assert.ok(origins.includes('http://127.0.0.1:5173'));
  assert.ok(origins.includes('http://localhost:4173'));
  assert.ok(origins.includes('http://127.0.0.1:4173'));
});
