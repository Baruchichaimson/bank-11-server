import mongoose from "mongoose";
import { Account } from "../entities/accounts.js";
import { Transaction } from "../entities/transactions.js";
import { User } from "../entities/users.js";

const TX_NOT_SUPPORTED_MESSAGE =
  "Transaction numbers are only allowed on a replica set member or mongos";

const isTransactionNotSupportedError = (error) =>
  String(error?.message || "").includes(TX_NOT_SUPPORTED_MESSAGE);

const performTransfer = async ({
  fromAccountId,
  toAccountId,
  amount,
  description,
  session = null,
}) => {
  const fromAccountQuery = Account.findById(fromAccountId);
  const toAccountQuery = Account.findById(toAccountId);

  const fromAccount = session
    ? await fromAccountQuery.session(session)
    : await fromAccountQuery;
  const toAccount = session
    ? await toAccountQuery.session(session)
    : await toAccountQuery;

  if (!fromAccount || !toAccount) {
    throw new Error("Account not found");
  }

  if (String(receiverUser.email) === String(senderUserId.email)) {
    throw new Error("receiver and sender are equal");
  }

  if (fromAccount.status !== "ACTIVE") {
    throw new Error("Source account is not active");
  }

  if (fromAccount.balance < amount) {
    throw new Error("Insufficient funds");
  }

  const fromUserQuery = User.findById(fromAccount.userId).select("email");
  const toUserQuery = User.findById(toAccount.userId).select("email");
  const fromUser = session
    ? await fromUserQuery.session(session)
    : await fromUserQuery;
  const toUser = session ? await toUserQuery.session(session) : await toUserQuery;

  if (!fromUser?.email || !toUser?.email) {
    throw new Error("User email not found");
  }

  fromAccount.balance -= amount;
  toAccount.balance += amount;

  if (session) {
    await fromAccount.save({ session });
    await toAccount.save({ session });
  } else {
    await fromAccount.save();
    await toAccount.save();
  }

  const transactionId = Date.now() + Math.floor(Math.random() * 1000);
  if (session) {
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
    return transaction[0];
  }

  return Transaction.create({
    id: transactionId,
    fromEmail: fromUser.email,
    toEmail: toUser.email,
    amount,
    status: "COMPLETED",
    description,
  });
};

export const transferMoney = async ({
  fromAccountId,
  toAccountId,
  amount,
  description,
}) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    const transaction = await performTransfer({
      fromAccountId,
      toAccountId,
      amount,
      description,
      session,
    });
    await session.commitTransaction();
    return transaction;
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch {
      // Ignore abort errors. We fallback below only when transactions are unsupported.
    }

    if (isTransactionNotSupportedError(err)) {
      return performTransfer({
        fromAccountId,
        toAccountId,
        amount,
        description,
      });
    }

    throw err;
  } finally {
    session.endSession();
  }
};

export const findTransactionsByUserId = async (
  userId,
  { limit, offset } = {}
) => {
  const user = await User.findById(userId).select("email");
  if (!user?.email) {
    return [];
  }

  const query = Transaction.find({
    $or: [{ fromEmail: user.email }, { toEmail: user.email }]
  }).sort({ createdAt: -1 });

  if (Number.isInteger(offset) && offset > 0) {
    query.skip(offset);
  }

  if (Number.isInteger(limit) && limit > 0) {
    query.limit(limit);
  }

  return query;
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

  return Transaction.find({
    fromEmail: user.email,
    toEmail: recipientEmailRegex,
  }).sort({ createdAt: -1 });
};
