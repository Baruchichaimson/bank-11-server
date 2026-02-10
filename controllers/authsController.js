import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import crypto from 'crypto';

import usersModel from '../models/usersModel.js';
import accountsModel from '../models/accountsModel.js';
import { isValidEmail, isValidPhone } from '../utils/validators.js';
import { sendVerificationEmail } from '../utils/email.js';
import { sendPasswordResetEmail } from '../utils/email.js';
import { JWT_SECRET } from '../middleware/auth.js';

/* ================= REGISTER ================= */
const signup = async (req, res) => {
  try {
    const { email, password, phoneNumber, firstName, lastName } = req.body;

    if (!email || !password || !phoneNumber || !firstName || !lastName) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!isValidPhone(phoneNumber)) {
      return res.status(400).json({ message: 'Invalid phone number format' });
    }

    console.log("email to find user:", email);
    const existingUser = await usersModel.findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ message: 'Email already registered' });
    }
    console.log("password before hash:", password);
    const passwordHash = await bcrypt.hash(password, 10);
    const verificationToken = randomUUID();
    console.log("verfication tokken:", verificationToken);
    const user = await usersModel.createUser({
      firstName,
      lastName,
      email,
      phoneNumber,
      password: passwordHash,
      isVerified: false,
      verificationToken,
      verificationExpires: Date.now() + 24 * 60 * 60 * 1000
    });

    /* 🔐 פעולות משניות – לא מפילות signup */
try {
  await accountsModel.createAccount(user._id);
} catch (accountErr) {
  console.error('Create account failed:', accountErr?.message || accountErr);
}

try {
  await sendVerificationEmail(email, verificationToken);
} catch (emailErr) {
  console.error('Verification email failed:', emailErr?.message || emailErr);
}

return res.status(201).json({
  message: 'Registration successful. Please verify your email.'
});


  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ================= VERIFY ================= */
const renderVerifyHtml = (res, statusCode, title, message) => {
  res.status(statusCode).send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${title}</title>
      </head>
      <body style="font-family: Arial, sans-serif; background:#f5f7fa; padding:40px;">
        <div style="
          max-width:520px;
          margin:0 auto;
          background:#fff;
          border-radius:12px;
          padding:28px;
          box-shadow:0 10px 30px rgba(0,0,0,0.08);
        ">
          <h2 style="margin:0 0 12px 0;color:#0c4a6e;">
            ${title}
          </h2>

          <p style="margin:0;color:#334155;">
            ${message}
          </p>

          <p style="margin:18px 0 0;color:#64748b;font-size:14px;">
            You can now close this tab and return to the application.
          </p>
        </div>
      </body>
    </html>
  `);
};


const verify = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return renderVerifyHtml(
        res,
        400,
        'Verification failed',
        'Invalid or missing verification token.'
      );
    }

    const user = await usersModel.findUserByVerificationToken(token.trim());

    if (!user) {
      return renderVerifyHtml(
        res,
        400,
        'Verification failed',
        'This verification link is invalid or has already been used.'
      );
    }

    if (user.isVerified) {
      return renderVerifyHtml(
        res,
        200,
        'Account already verified',
        'Your account is already verified. You can log in.'
      );
    }

    if (!user.verificationExpires || Date.now() > user.verificationExpires) {
      return renderVerifyHtml(
        res,
        400,
        'Verification link expired',
        'This verification link has expired. Please register again.'
      );
    }

    // ✅ verify user
    user.isVerified = true;
    user.verificationToken = null;
    user.verificationExpires = null;
    await user.save();

    // ✅ activate account if exists
    const account = await accountsModel.findAccountByUserId(user._id);
    if (account) {
      await accountsModel.updateAccountStatus(account._id, 'ACTIVE');
    }

    return renderVerifyHtml(
      res,
      200,
      'Account verified successfully',
      'Your account has been verified. You can now log in.'
    );
  } catch (err) {
    console.error('VERIFY ERROR:', err);
    return renderVerifyHtml(
      res,
      500,
      'Verification error',
      'An unexpected error occurred. Please try again later.'
    );
  }
};



/* ================= LOGIN ================= */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    console.log('LOGIN EMAIL RAW:', email);
    console.log('LOGIN EMAIL NORMALIZED:', normalizedEmail);

    const user = await usersModel.findUserByEmailWithPassword(normalizedEmail);

    console.log('USER FOUND:', Boolean(user));
    console.log('HAS PASSWORD:', Boolean(user?.password));

    if (!user || !user.password) {
      return res.status(401).json({ message: 'User not registered' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ message: 'Account not verified' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) 
    {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const accessToken = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        firstName: user.firstName,
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    return res.status(200).json({ accessToken });

  } 
  catch (err) 
  {
    console.error('LOGIN ERROR:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/* ================= LOGOUT ================= */

const logout = (req, res) => {
  return res.status(200).json({
    message: 'Logged out successfully'
  });
};

/* ================= FORGOT PASSWORD ================= */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await usersModel.findUserByEmail(email);
    if (!user) {
      return res.status(404).json({ message: 'User not registered' });
    }

    const resetToken = randomUUID();
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000;
    await user.save();

    await sendPasswordResetEmail(email, resetToken);

    return res.status(200).json({
      message: 'Password reset email sent'
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ================= RESET PASSWORD ================= */
const resetPassword = async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;

    if (!token || !password || !confirmPassword) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    const user = await usersModel.findUserByResetToken(token);
    if (!user) {
      return res.status(404).json({ message: 'Invalid or expired token' });
    }

    if (Date.now() > user.resetPasswordExpires) {
      return res.status(400).json({ message: 'Token expired' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    return res.status(200).json({
      message: 'Password updated successfully'
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ================= VERIFY STATUS ================= */
const verifyStatus = async (req, res) => {
  try {
    const { email } = req.query;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await usersModel.findUserByEmail(email.trim());
    if (!user) {
      return res.status(404).json({ message: 'User not registered' });
    }

    return res.status(200).json({
      isVerified: Boolean(user.isVerified)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ================= JOTFORM IDENTITY ================= */
const jotformIdentity = async (req, res) => {
  try {
    const secret = process.env.JOTFORM_AGENT_SECRET;
    if (!secret) {
      return res.status(503).json({
        message: 'Jotform integration is not configured'
      });
    }

    const userID = String(req.userId);
    const userHash = crypto
      .createHmac('sha256', secret)
      .update(userID)
      .digest('hex');

    const user = req.userRecord;
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();

    return res.status(200).json({
      userID,
      userHash,
      metadata: {
        name: fullName || user.email,
        email: user.email,
        company: 'Bank One One'
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};

export default {
  signup,
  verify,
  login,
  logout,
  forgotPassword,
  resetPassword,
  verifyStatus,
  jotformIdentity
};
