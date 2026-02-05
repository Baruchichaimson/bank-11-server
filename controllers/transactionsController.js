import usersModel from '../models/usersModel.js';
import accountsModel from '../models/accountsModel.js';
import {
  transferMoney,
  findTransactionsByUserId,
  findTransactionById
} from '../models/transactionsModel.js';

/* ================= CREATE TRANSACTION ================= */
const createTransaction = async (req, res) => {
  try {
    const { receiverEmail, amount, description } = req.body;
    const senderUserId = req.userId;

    if (!receiverEmail || !amount) {
      return res.status(400).json({
        message: 'receiverEmail and amount are required'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        message: 'Amount must be greater than zero'
      });
    }

    const receiverUser = await usersModel.findUserByEmail(receiverEmail);

    if (!receiverUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const senderAccount = await accountsModel.findAccountByUserId(senderUserId);
    const receiverAccount = await accountsModel.findAccountByUserId(receiverUser._id);

    if (!senderAccount || !receiverAccount) {
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

  const transactions = await findTransactionsByUserId(req.userId);
  const response = transactions.map((transaction) => ({
    ...transaction.toObject(),
    sign: transaction.fromEmail === email ? '-' : '+'
  }));

  return res.json(response);
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

export default {
  createTransaction,
  getTransactions,
  getTransactionById
};
