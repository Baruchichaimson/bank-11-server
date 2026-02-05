import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    firstName: 
    {
      type: String,
      required: true,
      minlength: 2,
    },

    lastName: 
    {
      type: String,
      required: true,
      minlength: 2,
    },

    email: 
    {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },

    phoneNumber: 
    {
      type: String,
      required: true,
      unique: true,
      match: /^[0-9]{9,10}$/,
    },

    password: 
    {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },

    isVerified: 
    {
        type: Boolean,
        default: false,
    },

    verificationToken: String,

    verificationExpires: Date,

    resetPasswordToken: String,

    resetPasswordExpires: Date,
  },
  { 
    timestamps: true 
  }
);

export const User = mongoose.model("User", userSchema);
