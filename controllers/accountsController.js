import accountsModel from '../models/accountsModel.js';
import { findTransactionsByUserId } from '../models/transactionsModel.js';

const getAccount = async (req, res) => {
  try {
    const userId = req.userId;

    /* ---------- Account ---------- */
    const account = await accountsModel.findAccountByUserId(userId);

    if (!account) {
      return res.status(404).json({
        message: 'Account not found'
      });
    }

    /* ---------- Transactions ---------- */
    const transactions = await findTransactionsByUserId(userId);

    /* ---------- Success ---------- */
    return res.status(200).json({
      account,
      transactions
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
