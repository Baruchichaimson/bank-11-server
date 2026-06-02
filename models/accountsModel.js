import { Account } from "../entities/accounts.js";

/* ---------- DB Functions ---------- */

const createAccount = async (userId, status = 'PENDING') => {
  return Account.create({ 
    userId ,
    status,
    balance : Math.floor(Math.random() * (5000 - 100 + 1)) + 100
  });
};

const findAccountByUserId = async (userId) => {
  return Account.findOne({ userId });
};

const findAccountById = async (id) => {
  return Account.findById(id);
};

const updateAccountStatus = async (accountId, status) => {
  return Account.findByIdAndUpdate(
    accountId,
    { status },
    { new: true }
  );
};

const deletePendingAccountsByUserIds = async (userIds) => {
  return Account.deleteMany({
    userId: { $in: userIds },
    status: 'PENDING'
  });
};

export default {
  createAccount,
  findAccountByUserId,
  findAccountById,
  updateAccountStatus,
  deletePendingAccountsByUserIds,
};
