import usersModel from '../models/usersModel.js';
import accountsModel from '../models/accountsModel.js';
import {
  transferMoney,
  findTransactionsByUserId,
  findTransactionById,
  findTransactionsWithCounterpartyName
} from '../models/transactionsModel.js';

/* ================= CREATE TRANSACTION ================= */
const createTransaction = async (req, res) => {
  try {
    const { receiverEmail, amount, description } = req.body;
    const senderUserId = req.userId;
    const senderEmail = String(req.user?.email || '').toLowerCase().trim();
    const normalizedReceiverEmail = String(receiverEmail || '').toLowerCase().trim();

    if (!normalizedReceiverEmail || !amount) {
      return res.status(400).json({
        message: 'receiverEmail and amount are required'
      });
    }
                                                     
    if (amount <= 0) {
      return res.status(400).json({
        message: 'Amount must be greater than zero'
      });
    }

    if (senderEmail && normalizedReceiverEmail === senderEmail) {
      return res.status(400).json({
        message: 'receiver and sender are equal'
      });
    }

    const receiverUser = await usersModel.findUserByEmail(normalizedReceiverEmail);

    if (!receiverUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (String(receiverUser._id) === String(senderUserId)) {
      return res.status(400).json({
        message: 'receiver and sender are equal'
      });
    }

    const senderAccount = await accountsModel.findAccountByUserId(senderUserId);
    const receiverAccount = await accountsModel.findAccountByUserId(receiverUser._id);

    if (!senderAccount || !receiverAccount) 
    {
      return res.status(404).json({ message: 'Account not found' });
    }

    const transaction = await transferMoney({
      fromAccountId: senderAccount._id,
      toAccountId: receiverAccount._id,
      amount,
      description
    });

    const updatedSenderAccount = await accountsModel.findAccountById(senderAccount._id);
    const updatedReceiverAccount = await accountsModel.findAccountById(receiverAccount._id);

    return res.status(201).json({
      message: 'Transaction completed',
      senderBalance: updatedSenderAccount?.balance,
      receiverBalance: updatedReceiverAccount?.balance,
      transaction
    });
  } catch (err) {
    return res.status(400).json({
      message: err?.message || 'Transaction failed'
    });
  }
};

/* ================= GET ALL TRANSACTIONS ================= */
const getTransactions = async (req, res) => {
  const { email } = req.user;
  const parsedLimit = Number.parseInt(req.query.limit, 10);
  const parsedOffset = Number.parseInt(req.query.offset, 10);
  const hasPagination = Number.isInteger(parsedLimit) && parsedLimit > 0;
  const limit = hasPagination ? parsedLimit : undefined;
  const offset = Number.isInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

  const queryLimit = hasPagination ? limit + 1 : undefined;
  const transactions = await findTransactionsByUserId(req.userId, {
    limit: queryLimit,
    offset
  });
  const response = transactions.map((transaction) => ({
    ...transaction.toObject(),
    sign: transaction.fromEmail === email ? '-' : '+'
  }));

  if (!hasPagination) {
    return res.json(response);
  }

  const hasMore = response.length > limit;
  const pageTransactions = hasMore ? response.slice(0, limit) : response;

  return res.json({
    transactions: pageTransactions,
    pagination: {
      limit,
      offset,
      hasMore
    }
  });
};

/* ================= GET TRANSACTION BY ID ================= */
const getTransactionById = async (req, res) => {
  const { transactionId } = req.params;

  const transaction = await findTransactionById(transactionId);

  if (!transaction) {
    return res.status(404).json({ message: 'Transaction not found' });
  }

  return res.json(transaction);
};

/* ================= GET TRANSACTIONS WITH COUNTERPARTY NAME ================= */
const getSentTransactionByRecipientName = async (req, res) => {
  const { recipientName } = req.params;

  if (!recipientName?.trim()) {
    return res.status(400).json({ message: 'recipientName is required' });
  }

  const transactions = await findTransactionsWithCounterpartyName(req.userId, recipientName);

  if (!transactions?.length) {
    return res.status(404).json({ message: 'Transaction not found' });
  }

  return res.json(transactions);
};

export default {
  createTransaction,
  getTransactions,
  getTransactionById,
  getSentTransactionByRecipientName
};
