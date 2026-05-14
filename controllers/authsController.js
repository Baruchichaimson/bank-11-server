import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

import usersModel from '../models/usersModel.js';
import accountsModel from '../models/accountsModel.js';
import { isValidEmail, isValidPhone } from '../utils/validators.js';
import { sendVerificationEmail } from '../utils/email.js';
import { sendPasswordResetEmail } from '../utils/email.js';
import { JWT_SECRET } from '../middleware/auth.js';

const AUTH_COOKIE_NAME = 'access_token';
const AUTH_COOKIE_MAX_AGE_MS = 60 * 60 * 1000;

const getAuthCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
    path: '/'
  };
};

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

    // verify user
    user.isVerified = true;
    user.verificationToken = null;
    user.verificationExpires = null;
    await user.save();

    // activate account if exists
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

    res.cookie(AUTH_COOKIE_NAME, accessToken, getAuthCookieOptions());
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
  const cookieOptions = getAuthCookieOptions();
  const expiredCookieOptions = {
    ...cookieOptions,
    expires: new Date(0),
    maxAge: 0
  };

  res.clearCookie(AUTH_COOKIE_NAME, expiredCookieOptions);
  res.cookie(AUTH_COOKIE_NAME, '', expiredCookieOptions);

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

    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await usersModel.findUserByEmail(normalizedEmail);
    if (!user) {
      return res.status(404).json({ message: 'User not registered' });
    }

    const resetToken = randomUUID();
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000;
    await user.save();

    await sendPasswordResetEmail(normalizedEmail, resetToken);

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

    if (!user.resetPasswordExpires || Date.now() > user.resetPasswordExpires) {
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

/* ================= OPEN RESET PASSWORD PAGE ================= */
const openResetPasswordPage = (req, res) => {
  const token = String(req.params?.token || req.query?.token || '').trim();

  if (!token) {
    return res.status(400).send('Missing reset token');
  }
  const escapedToken = token.replace(/"/g, '&quot;');
  return res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Reset Password | Bank One One</title>
        <style>
          :root {
            --brand-1: #0b4fa2;
            --brand-2: #1a73e8;
            --bg-1: #eaf2ff;
            --bg-2: #f6f9ff;
            --ink: #0f172a;
            --muted: #475569;
            --ok: #166534;
            --ok-bg: #dcfce7;
            --err: #991b1b;
            --err-bg: #fee2e2;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            font-family: "Segoe UI", Tahoma, Arial, sans-serif;
            color: var(--ink);
            background: linear-gradient(145deg, var(--bg-1), var(--bg-2));
            display: grid;
            place-items: center;
            padding: 20px;
          }
          .card {
            width: 100%;
            max-width: 460px;
            background: #fff;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 12px 30px rgba(15, 23, 42, 0.14);
          }
          .head {
            padding: 20px 24px;
            background: linear-gradient(90deg, var(--brand-1), var(--brand-2));
            color: #fff;
            font-weight: 700;
            font-size: 20px;
          }
          .content { padding: 24px; }
          .title { margin: 0 0 8px; font-size: 24px; }
          .desc { margin: 0 0 18px; color: var(--muted); }
          label { display: block; font-size: 14px; margin: 10px 0 6px; color: #1e293b; }
          input {
            width: 100%;
            border: 1px solid #cbd5e1;
            border-radius: 10px;
            padding: 11px 12px;
            font-size: 15px;
            outline: none;
          }
          input:focus {
            border-color: var(--brand-2);
            box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.16);
          }
          button {
            width: 100%;
            margin-top: 16px;
            border: 0;
            border-radius: 10px;
            padding: 12px;
            font-size: 16px;
            font-weight: 700;
            color: #fff;
            background: linear-gradient(90deg, var(--brand-1), var(--brand-2));
            cursor: pointer;
          }
          button:disabled { opacity: 0.7; cursor: not-allowed; }
          .status {
            display: none;
            margin-top: 12px;
            padding: 10px 12px;
            border-radius: 8px;
            font-size: 14px;
          }
          .status.ok { display: block; color: var(--ok); background: var(--ok-bg); }
          .status.err { display: block; color: var(--err); background: var(--err-bg); }
        </style>
      </head>
      <body>
        <main class="card">
          <div class="head">Bank One One</div>
          <section class="content">
            <h1 class="title">Reset Password</h1>
            <p class="desc">Choose your new password to continue.</p>
            <form id="resetForm">
              <input type="hidden" id="token" value="${escapedToken}" />
              <label for="password">New password</label>
              <input id="password" type="password" minlength="6" required />
              <label for="confirmPassword">Confirm password</label>
              <input id="confirmPassword" type="password" minlength="6" required />
              <button type="submit" id="submitBtn">Update password</button>
              <div id="status" class="status"></div>
            </form>
          </section>
        </main>
        <script>
          const form = document.getElementById('resetForm');
          const submitBtn = document.getElementById('submitBtn');
          const statusEl = document.getElementById('status');

          const showStatus = (type, message) => {
            statusEl.className = 'status ' + type;
            statusEl.textContent = message;
          };

          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const token = document.getElementById('token').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            submitBtn.disabled = true;
            submitBtn.textContent = 'Updating...';
            statusEl.className = 'status';
            statusEl.textContent = '';

            try {
              const response = await fetch('/api/v1/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password, confirmPassword })
              });
              const result = await response.json();

              if (!response.ok) {
                showStatus('err', result.message || 'Password update failed');
              } else {
                showStatus('ok', 'Password updated successfully. You can now sign in.');
                form.reset();
              }
            } catch (error) {
              showStatus('err', 'Network error. Please try again.');
            } finally {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Update password';
            }
          });
        </script>
      </body>
    </html>
  `);
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
  openResetPasswordPage,
  verifyStatus
};
