import jwt from 'jsonwebtoken';
import usersModel from '../models/usersModel.js';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('Missing required environment variable: JWT_SECRET');
}

export { JWT_SECRET };

/* =================================================
   1️⃣ Authenticate Token (Header-based)
================================================= */
export const authenticateToken = (req, res, next) => {
  let token = null;

  /* ---------- Authorization Header ---------- */
  const authHeader = req.headers.authorization;

  if (authHeader && typeof authHeader === 'string') {
    const [scheme, credentials] = authHeader.split(' ');

    if (scheme === 'Bearer' && credentials) {
      token = credentials.trim();
    }
  }

  if (!token) {
    token = req.cookies?.access_token || null;
  }

  /* ---------- No token ---------- */
  if (!token) {
    return res.status(401).json({
      message: 'Authorization token missing'
    });
  }

  /* ---------- Verify token ---------- */
  try {
    const payload = jwt.verify(token, JWT_SECRET);

    /*
      payload example:
      {
        userId,
        email,
        iat,
        exp
      }
    */

    req.user = payload;          // full JWT payload
    req.userId = payload.userId; // shortcut for controllers

    next();
  } catch (err) {
    return res.status(401).json({
      message: 'Invalid or expired token'
    });
  }
};

/* =================================================
   2️⃣ Require Verified User
   - Ensures user exists
   - Ensures user is verified
   - Attaches full user record
================================================= */
export const requireVerifiedUser = async (req, res, next) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: 'Authorization token missing'
      });
    }

    const user = await usersModel.findUserById(req.userId);

    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        message: 'User is not verified'
      });
    }

    const tokenVersionFromJwt = Number(req.user?.tokenVersion || 0);
    const tokenVersionFromDb = Number(user.tokenVersion || 0);
    if (tokenVersionFromJwt !== tokenVersionFromDb) {
      return res.status(401).json({
        message: 'Session is no longer valid'
      });
    }

    req.userRecord = user; // full DB user if needed
    next();

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: 'Server error'
    });
  }
};
