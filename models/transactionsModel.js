import mongoose from "mongoose";
import { Account } from "../entities/accounts.js";
import { Transaction } from "../entities/transactions.js";
import { User } from "../entities/users.js";

export const transferMoney = async ({
  fromAccountId,
  toAccountId,
  amount,
  description,
}) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    /* ---- fetch accounts ---- */
    const fromAccount = await Account.findById(fromAccountId).session(session);
    const toAccount = await Account.findById(toAccountId).session(session);

    if (!fromAccount || !toAccount) {
      throw new Error("Account not found");
    }

    if (fromAccount.status !== "ACTIVE") {
      throw new Error("Source account is not active");
    }

    if (fromAccount.balance < amount) {
      throw new Error("Insufficient funds");
    }

    const fromUser = await User.findById(fromAccount.userId).select("email");
    const toUser = await User.findById(toAccount.userId).select("email");

    if (!fromUser?.email || !toUser?.email) {
      throw new Error("User email not found");
    }

    /* ---- update balances ---- */
    fromAccount.balance -= amount;
    toAccount.balance += amount;

    await fromAccount.save({ session });
    await toAccount.save({ session });

    /* ---- create transaction ---- */
    const transactionId = Date.now() + Math.floor(Math.random() * 1000);
    const transaction = await Transaction.create(
      [
        {
          id: transactionId,
          fromEmail: fromUser.email,
          toEmail: toUser.email,
          amount,
          status: "COMPLETED",
          description,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return transaction[0];
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
};

export const findTransactionsByUserId = async (userId) => {
  const user = await User.findById(userId).select("email");
  if (!user?.email) {
    return [];
  }

  return Transaction.find({
    $or: [{ fromEmail: user.email }, { toEmail: user.email }]
  }).sort({ createdAt: -1 });
};

export const findTransactionById = async (transactionId) => {
  if (!mongoose.Types.ObjectId.isValid(transactionId)) {
    const numericId = Number(transactionId);
    if (!Number.isNaN(numericId)) {
      return Transaction.findOne({ id: numericId });
    }
    return null;
  }

  return Transaction.findById(transactionId);
};

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const findSentTransactionByRecipientName = async (userId, recipientName) => {
  const user = await User.findById(userId).select("email");
  if (!user?.email) {
    return null;
  }

  const normalizedName = recipientName?.trim();
  if (!normalizedName) {
    return null;
  }

  const safeName = escapeRegex(normalizedName);
  const recipientEmailRegex = new RegExp(`^${safeName}@`, "i");

  return Transaction.findOne({
    fromEmail: user.email,
    toEmail: recipientEmailRegex,
  }).sort({ createdAt: -1 });
};
