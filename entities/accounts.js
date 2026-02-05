import mongoose from "mongoose";

const accountSchema = new mongoose.Schema(
  {
    userId:
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    status:
    {
      type: String,
      enum: ["PENDING", "ACTIVE", "BLOCKED"],
      default: "PENDING",
      required: true,
    },

    balance:
    {
      type: Number,
      default: 500,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

export const Account = mongoose.model("Account",accountSchema);
