import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    id:
    {
      type: Number,
      required: true,
      unique: true,
    },

    fromEmail:
    {
      type: String,
      required: true,
      lowercase: true,
    },

    toEmail:
    {
      type: String,
      required: true,
      lowercase: true,
    },

    amount:
    {
      type: Number,
      required: true,
      min: 0.01,
    },

    status:
    {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED"],
      default: "PENDING",
      required: true,
    },

    description:
    {
      type: String,
      maxlength: 255,
    },
  },
  {
    timestamps: true,
  }
);

transactionSchema.index({ fromEmail: 1, createdAt: -1 });
transactionSchema.index({ toEmail: 1, createdAt: -1 });

export const Transaction = mongoose.model("Transaction", transactionSchema);