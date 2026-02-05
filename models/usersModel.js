import { User } from "../entities/users.js";

/* ---------- DB Functions ---------- */

const createUser = async (data) => {
  return User.create(data);
};

const findUserByEmail = async (email) => {
  return User.findOne({ email });
};

const findUserByEmailWithPassword = async (email) => {
  return User.findOne({ email }).select('+password');
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

export default {
  createUser,
  findUserByEmail,
  findUserByEmailWithPassword,
  findUserById,
  findUserByVerificationToken,
  findUserByResetToken,
  verifyUser,
};
