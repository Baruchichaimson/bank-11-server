import { Account } from "../entities/accounts.js";

/* ---------- DB Functions ---------- */

const createAccount = async (userId) => {
  return Account.create({ 
    userId ,
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

export default {
  createAccount,
  findAccountByUserId,
  findAccountById,
  updateAccountStatus,
};
