import accountsModel from '../models/accountsModel.js';
import {
  findSentTransactionByRecipientName,
  findTransactionsByUserId
} from '../models/transactionsModel.js';

const toIso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toDateRange = (from, to) => {
  const now = new Date();
  const start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = to ? new Date(to) : now;

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return { start, end };
};

export const bankTools = [
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
          from: {
            type: 'string',
            description: 'Optional ISO date like 2026-02-01'
          },
          to: {
            type: 'string',
            description: 'Optional ISO date like 2026-02-28'
          }
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
          recipientName: {
            type: 'string',
            description: 'Recipient email local part, for example "danny"'
          }
        },
        required: ['recipientName']
      }
    }
  }
];

export const executeBankTool = async ({ name, args, userId }) => {
  if (name === 'get_balance') {
    const account = await accountsModel.findAccountByUserId(userId);
    if (!account) {
      return { found: false, message: 'Account not found' };
    }

    return {
      found: true,
      balance: account.balance,
      status: account.status,
      currency: 'ILS'
    };
  }

  if (name === 'get_last_transfer') {
    const transactions = await findTransactionsByUserId(userId);
    const tx = transactions[0];

    if (!tx) {
      return { found: false, message: 'No transactions found' };
    }

    return {
      found: true,
      id: tx.id,
      fromEmail: tx.fromEmail,
      toEmail: tx.toEmail,
      amount: tx.amount,
      status: tx.status,
      description: tx.description || null,
      createdAt: toIso(tx.createdAt)
    };
  }

  if (name === 'count_transfers') {
    const range = toDateRange(args?.from, args?.to);
    if (!range) {
      return { found: false, message: 'Invalid date range format' };
    }

    const transactions = await findTransactionsByUserId(userId);
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

  if (name === 'get_last_sent_transfer_to_recipient') {
    const recipientName = args?.recipientName?.trim();
    if (!recipientName) {
      return { found: false, message: 'recipientName is required' };
    }

    const sent = await findSentTransactionByRecipientName(userId, recipientName);
    const tx = Array.isArray(sent) ? sent[0] : null;

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
      amount: tx.amount,
      status: tx.status,
      description: tx.description || null,
      createdAt: toIso(tx.createdAt)
    };
  }

  return { found: false, message: `Unsupported tool: ${name}` };
};
