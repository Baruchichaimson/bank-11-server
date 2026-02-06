import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

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

/* ✅ תמיד חוזרים הצלחה */
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
        <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 10px 30px rgba(0,0,0,0.08);">
          <h2 style="margin:0 0 12px 0;color:#0c4a6e;">${title}</h2>
          <p style="margin:0;color:#334155;">${message}</p>
          <p style="margin:18px 0 0;color:#64748b;font-size:14px;">
            You can return to the registration tab.
          </p>
        </div>
      </body>
    </html>
  `);
};


const verify = async (req, res) => {
  const frontendBaseUrl =
    process.env.FRONTEND_BASE_URL || process.env.APP_BASE_URL;

  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.redirect(`${frontendBaseUrl}/login?verified=0`);
    }

    const user = await usersModel.findUserByVerificationToken(token.trim());

    if (!user) {
      return res.redirect(`${frontendBaseUrl}/login?verified=0`);
    }

    if (user.isVerified) {
      return res.redirect(`${frontendBaseUrl}/login?verified=1`);
    }

    if (Date.now() > user.verificationExpires) {
      return res.redirect(`${frontendBaseUrl}/login?verified=0`);
    }

    user.isVerified = true;
    user.verificationToken = null;
    user.verificationExpires = null;
    await user.save();

    const account = await accountsModel.findAccountByUserId(user._id);
    if (account) {
      await accountsModel.updateAccountStatus(account._id, 'ACTIVE');
    }

    // ✅ הצלחה
    return res.redirect(`${frontendBaseUrl}/login?verified=1`);

  } catch (err) {
    console.error('VERIFY ERROR:', err);
    return res.redirect(`${frontendBaseUrl}/login?verified=0`);
  }
};


// const verify = async (req, res) => {
//   const frontendBaseUrl =
//     process.env.FRONTEND_BASE_URL || process.env.APP_BASE_URL;
//   try {
//     const { token: rawToken } = req.query;
//     const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
//     const wantsHtml = req.headers.accept?.includes('text/html');

//     if (!token || typeof token !== 'string' || !token.trim()) {
//       if (wantsHtml) {
//         return renderVerifyHtml(res, 400, 'Verification failed', 'Token is required.');
//       }
//       return res.status(400).json({ message: 'Token is required' });
//     }

//     const normalizedToken = token.trim();

//     const user = await usersModel.findUserByVerificationToken(normalizedToken);
//     if (!user) {
//       if (wantsHtml) {
//         return renderVerifyHtml(res, 404, 'Verification failed', 'Invalid token.');
//       }
//       return res.status(404).json({ message: 'Invalid token' });
//     }

//     if (user.isVerified) {
//       if (wantsHtml) {
//         return renderVerifyHtml(res, 200, 'Already verified', 'This account is already verified.');
//       }
//       return res.status(400).json({ message: 'User already verified' });
//     }

//     if (Date.now() > user.verificationExpires) {
//       if (wantsHtml) {
//         return renderVerifyHtml(res, 400, 'Verification failed', 'Token expired.');
//       }
//       return res.status(400).json({ message: 'Token expired' });
//     }

//     user.isVerified = true;
//     user.verificationToken = null;
//     user.verificationExpires = null;
//     await user.save();

//     const account = await accountsModel.findAccountByUserId(user._id);
//     if (account) 
//     {
//       await accountsModel.updateAccountStatus(account._id, 'ACTIVE');
//     }

//     const accessToken = jwt.sign(
//       {
//         userId: user._id,
//         email: user.email
//       },
//       JWT_SECRET,
//       { expiresIn: '1h' }
//     );

//     if (wantsHtml) {
//       return renderVerifyHtml(
//         res,
//         200,
//         'Verified successfully',
//         'Your account has been verified.'
//       );
//     }

//     return res.status(200).json({
//       message: 'Account verified successfully',
//       accessToken
//     });

//   } catch (err) {
//     console.error(err);
//     if (req.headers.accept?.includes('text/html')) {
//       return renderVerifyHtml(res, 500, 'Verification failed', 'Server error.');
//     }
//     return res.status(500).json({ message: 'Server error' });
//   }
// };

// /* ================= LOGIN ================= */
// const login = async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     if (!email || !password) {
//       return res.status(400).json({ message: 'Email and password required' });
//     }

//     // ✅ נרמול אימייל פעם אחת
//     const normalizedEmail = email.toLowerCase().trim();

//     console.log('LOGIN EMAIL RAW:', email);
//     console.log('LOGIN EMAIL NORMALIZED:', normalizedEmail);

//     // ✅ חיפוש עם אימייל מנורמל + password
//     const user = await usersModel.findUserByEmailWithPassword(normalizedEmail);

//     console.log('USER FOUND:', Boolean(user));
//     console.log('HAS PASSWORD:', Boolean(user?.password));

//     // ✅ הגנה לפני bcrypt
//     if (!user || !user.password) {
//       return res.status(401).json({ message: 'User not registered' });
//     }

//     if (!user.isVerified) {
//       return res.status(403).json({ message: 'Account not verified' });
//     }

//     const match = await bcrypt.compare(password, user.password);
//     if (!match) {
//       return res.status(401).json({ message: 'Invalid credentials' });
//     }

//     const accessToken = jwt.sign(
//       {
//         userId: user._id,
//         email: user.email
//       },
//       JWT_SECRET,
//       { expiresIn: '1h' }
//     );

//     return res.status(200).json({ accessToken });

//   } catch (err) {
//     console.error('LOGIN ERROR:', err);
//     return res.status(500).json({ message: 'Server error' });
//   }
// };


// /* ================= LOGOUT ================= */

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

export default {
  signup,
  verify,
  login,
  logout,
  forgotPassword,
  resetPassword,
  verifyStatus
};
