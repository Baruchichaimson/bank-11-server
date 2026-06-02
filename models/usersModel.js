import { User } from "../entities/users.js";

/* ---------- DB Functions ---------- */

const createUser = async (data) => {
  return User.create(data);
};

const findUserByEmail = async (email) => {
  return User.findOne({ email: String(email || '').toLowerCase().trim() });
};

const findUserByPhoneNumber = async (phoneNumber) => {
  return User.findOne({ phoneNumber: String(phoneNumber || '').trim() });
};

const findVerifiedUserByEmail = async (email) => {
  return User.findOne({
    email: String(email || '').toLowerCase().trim(),
    isVerified: true
  });
};

const findUserByEmailWithPassword = async (email) => {
  return User.findOne({ email: String(email || '').toLowerCase().trim() }).select('+password');
};

const findUserById = async (id) => {
  return User.findById(id);
};

const findUserByVerificationToken = async (token) => {
  return User.findOne({ verificationToken: token });
};

const findUserByResetToken = async (token) => {
  return User.findOne({ resetPasswordToken: token }).select('+password');
};

const verifyUser = async (userId) => {
  return User.findByIdAndUpdate(
    userId,
    {
      isVerified: true,
      verificationToken: null,
      verificationExpires: null
    },
    { new: true }
  );
};

const bumpTokenVersionById = async (userId) => {
  return User.findByIdAndUpdate(
    userId,
    { $inc: { tokenVersion: 1 } },
    { new: true }
  );
};

const findExpiredUnverifiedUsers = async (now = new Date()) => {
  return User.find({
    isVerified: false,
    verificationExpires: { $lte: now }
  }).select('_id');
};

const deleteExpiredUnverifiedUsersByIds = async (userIds, now = new Date()) => {
  return User.deleteMany({
    _id: { $in: userIds },
    isVerified: false,
    verificationExpires: { $lte: now }
  });
};

export default {
  createUser,
  findUserByEmail,
  findUserByPhoneNumber,
  findVerifiedUserByEmail,
  findUserByEmailWithPassword,
  findUserById,
  findUserByVerificationToken,
  findUserByResetToken,
  verifyUser,
  bumpTokenVersionById,
  findExpiredUnverifiedUsers,
  deleteExpiredUnverifiedUsersByIds,
};
