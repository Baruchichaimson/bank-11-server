import accountsModel from '../models/accountsModel.js';
import usersModel from '../models/usersModel.js';
import {
  findSentTransactionByRecipientName,
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

/*
  תיקון חשוב:
  - אם from/to ריקים או ""
  - לא נפסול
  - רק אם המשתמש שלח תאריך לא חוקי בפועל → נחזיר null
*/
const toDateRange = (from, to) => {
  const now = new Date();

  const hasFrom = typeof from === 'string' && from.trim() !== '';
  const hasTo = typeof to === 'string' && to.trim() !== '';

  const start = hasFrom
    ? new Date(from)
    : new Date(now.getFullYear(), now.getMonth(), 1);

  const end = hasTo
    ? new Date(to)
    : now;

  if (
    (hasFrom && Number.isNaN(start.getTime())) ||
    (hasTo && Number.isNaN(end.getTime()))
  ) {
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
      description: 'Get the latest outgoing transfer to recipient by local-part name before @',
      parameters: {
        type: 'object',
        properties: {
          recipientName: { type: 'string' }
        },
        required: ['recipientName']
      }
    }
  }
];

/* ================================
   Tool Execution
================================ */

export const executeBankTool = async ({ name, args = {}, userId }) => {

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

  /* ---------- Last Sent To Recipient ---------- */

  if (name === 'get_last_sent_transfer_to_recipient') {

    const recipientName = String(safeArgs.recipientName || '').trim();

    if (!recipientName) {
      return { found: false, message: 'recipientName is required' };
    }

    const sent = await findSentTransactionByRecipientName(userId, recipientName);
    const tx = Array.isArray(sent) && sent.length ? sent[0] : null;

    if (!tx) {
      return {
        found: false,
        message: `No outgoing transfer found for recipient ${recipientName}`
      };
    }

    return {
      found: true,
      id: tx.id,
      toEmail: tx.toEmail,
      amount: Number(tx.amount) || 0,
      status: tx.status,
      description: tx.description || null,
      createdAt: toIso(tx.createdAt)
    };
  }

  /* ---------- Fallback ---------- */

  return {
    found: false,
    message: `Unsupported tool: ${name}`
  };
};
