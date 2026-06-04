import accountsModel from '../models/accountsModel.js';
import usersModel from '../models/usersModel.js';
import {
  findTransactionsWithCounterpartyName,
  findTransactionsByUserId
} from '../models/transactionsModel.js';

/* ================================
   Helpers
================================ */

const toIso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

const parseDateValue = (value) => {
  if (value instanceof Date) return value;
  const text = String(value || '').trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toDateRange = (from, to) => {
  const now = new Date();

  const hasFrom = typeof from === 'string' && from.trim() !== '';
  const hasTo = typeof to === 'string' && to.trim() !== '';

  let start = hasFrom
    ? parseDateValue(from)
    : new Date(now.getFullYear(), now.getMonth(), 1);

  let end = hasTo
    ? parseDateValue(to)
    : now;

  const invalidFrom = hasFrom && (!start || Number.isNaN(start.getTime()));
  const invalidTo = hasTo && (!end || Number.isNaN(end.getTime()));

  if (invalidFrom || invalidTo) {
    return null;
  }

  start = startOfDay(start);
  end = endOfDay(end);

  if (start > end) {
    return null;
  }

  return { start, end };
};

/* ================================
   Tool Definitions
================================ */

export const bankTools = [
  {
    type: 'function',
    function: {
      name: 'open_video_call_window',
      description: 'Open the video call window so the user can start a call with a representative or another user',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_money_transfer_inline',
      description: 'Open the inline chat transfer form so the user can perform a new transfer',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_user_identity',
      description: 'Get authenticated user first name, last name and email',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_balance',
      description: 'Get the authenticated user current account balance and status',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_last_transfer',
      description: 'Get the most recent transfer (incoming or outgoing) for authenticated user',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'count_transfers',
      description: 'Count user transfers in optional date range',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_last_sent_transfer_to_recipient',
      description: 'Get recent transfers with a person by email local-part before @ (both outgoing and incoming)',
      parameters: {
        type: 'object',
        properties: {
          recipientName: { type: 'string' }
        },
        required: ['recipientName']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_transfers',
      description: 'Get recent transfers in optional date range for authenticated user',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          from: { type: 'string' },
          to: { type: 'string' }
        }
      }
    }
  }
];

/* ================================
   Tool Execution
================================ */

export const executeBankTool = async ({ name, args = {}, userId }) => {
  if (name === 'open_video_call_window') {
    return {
      found: true,
      action: 'open_video_call'
    };
  }

  if (name === 'open_money_transfer_inline') {
    return {
      found: true,
      action: { type: 'open_money_transfer_inline' }
    };
  }

  if (!userId) {
    return { found: false, message: 'Unauthorized request' };
  }

  const safeArgs = args || {};

  /* ---------- Identity ---------- */

  if (name === 'get_user_identity') {

    const user = await usersModel.findUserById(userId);

    if (!user) {
      return { found: false, message: 'User not found' };
    }

    return {
      found: true,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || ''
    };
  }

  /* ---------- Balance ---------- */

  if (name === 'get_balance') {

    const account = await accountsModel.findAccountByUserId(userId);

    if (!account) {
      return { found: false, message: 'Account not found' };
    }

    return {
      found: true,
      balance: Number(account.balance) || 0,
      status: account.status || 'UNKNOWN',
      currency: 'ILS'
    };
  }

  /* ---------- Last Transfer ---------- */

  if (name === 'get_last_transfer') {

    const transactions = await findTransactionsByUserId(userId);

    if (!transactions?.length) {
      return { found: false, message: 'No transactions found' };
    }

    const tx = transactions[0];

    return {
      found: true,
      id: tx.id,
      fromEmail: tx.fromEmail,
      toEmail: tx.toEmail,
      amount: Number(tx.amount) || 0,
      status: tx.status,
      description: tx.description || null,
      createdAt: toIso(tx.createdAt)
    };
  }

  /* ---------- Transfer Count ---------- */

  if (name === 'count_transfers') {

    const range = toDateRange(safeArgs.from, safeArgs.to);

    if (!range) {
      return { found: false, message: 'Invalid date range format' };
    }

    const transactions = await findTransactionsByUserId(userId);

    if (!transactions?.length) {
      return {
        found: true,
        count: 0,
        from: range.start.toISOString(),
        to: range.end.toISOString()
      };
    }

    const count = transactions.filter((tx) => {
      const createdAt = new Date(tx.createdAt);
      return createdAt >= range.start && createdAt <= range.end;
    }).length;

    return {
      found: true,
      count,
      from: range.start.toISOString(),
      to: range.end.toISOString()
    };
  }

  /* ---------- Transfers With Recipient (Bidirectional) ---------- */

  if (name === 'get_last_sent_transfer_to_recipient') {

    const recipientName = String(safeArgs.recipientName || '').trim();

    if (!recipientName) {
      return { found: false, message: 'recipientName is required' };
    }

    const transactions = await findTransactionsWithCounterpartyName(userId, recipientName);
    const items = (transactions || []).slice(0, 10).map((tx) => ({
      id: tx.id,
      fromEmail: tx.fromEmail,
      toEmail: tx.toEmail,
      amount: Number(tx.amount) || 0,
      status: tx.status,
      description: tx.description || null,
      createdAt: toIso(tx.createdAt)
    }));

    if (!items.length) {
      return {
        found: false,
        message: `No transfers found with recipient ${recipientName}`
      };
    }

    return {
      found: true,
      recipientName,
      count: items.length,
      items
    };
  }

  /* ---------- Recent Transfers ---------- */

  if (name === 'get_recent_transfers') {
    const range = toDateRange(safeArgs.from, safeArgs.to);
    if (!range) {
      return { found: false, message: 'Invalid date range format' };
    }

    const requestedLimit = Number(safeArgs.limit);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100)
      : 3;

    const transactions = await findTransactionsByUserId(userId);
    const filtered = (transactions || []).filter((tx) => {
      const createdAt = new Date(tx.createdAt);
      return createdAt >= range.start && createdAt <= range.end;
    });

    const items = filtered.slice(0, limit).map((tx) => ({
      id: tx.id,
      fromEmail: tx.fromEmail,
      toEmail: tx.toEmail,
      amount: Number(tx.amount) || 0,
      status: tx.status,
      description: tx.description || null,
      createdAt: toIso(tx.createdAt)
    }));

    return {
      found: true,
      count: items.length,
      from: range.start.toISOString(),
      to: range.end.toISOString(),
      items
    };
  }

  /* ---------- Fallback ---------- */

  return {
    found: false,
    message: `Unsupported tool: ${name}`
  };
};
