import accountsModel from '../models/accountsModel.js';
import { findTransactionsByUserId } from '../models/transactionsModel.js';

const getAccount = async (req, res) => {
  try {
    const userId = req.userId;
    const userEmail = String(req.user?.email || '').toLowerCase();
    const parsedLimit = Number.parseInt(req.query.transactionsLimit, 10);
    const parsedOffset = Number.parseInt(req.query.transactionsOffset, 10);
    const transactionsLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 5;
    const transactionsOffset = Number.isInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

    /* ---------- Account ---------- */
    const account = await accountsModel.findAccountByUserId(userId);

    if (!account) {
      return res.status(404).json({
        message: 'Account not found'
      });
    }

    /* ---------- Transactions ---------- */
    const transactions = await findTransactionsByUserId(userId, {
      limit: transactionsLimit,
      offset: transactionsOffset
    });
    const transactionsWithSign = transactions.map((transaction) => {
      const tx = transaction.toObject();
      const fromEmail = String(tx.fromEmail || '').toLowerCase();
      const toEmail = String(tx.toEmail || '').toLowerCase();
      const sign = fromEmail === userEmail ? '-' : toEmail === userEmail ? '+' : '';
      return {
        ...tx,
        sign
      };
    });

    /* ---------- Success ---------- */
    return res.status(200).json({
      account,
      transactions: transactionsWithSign,
      pagination: {
        limit: transactionsLimit,
        offset: transactionsOffset
      }
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: 'Server error'
    });
  }
};

export default {
  getAccount
};
