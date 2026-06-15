"""
Auth controller — exact port of authsController.js.
"""

import uuid
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt
from flask import request, jsonify, make_response

from config.settings import JWT_SECRET, IS_PRODUCTION
from models.user_model import (
    find_user_by_email,
    find_user_by_phone_number,
    find_user_by_email_with_password,
    find_user_by_verification_token,
    find_user_by_reset_token,
    create_user,
    save_user,
    bump_token_version_by_id,
)
from models.account_model import find_account_by_user_id, update_account_status, create_account
from utils.validators import is_valid_email, is_valid_phone
from utils.email_service import send_verification_email, send_password_reset_email

AUTH_COOKIE_NAME = "access_token"
AUTH_COOKIE_MAX_AGE_SEC = 60 * 60
VERIFICATION_TOKEN_MAX_AGE_SEC = 24 * 60 * 60


def _normalize_email(email) -> str:
    return str(email or "").lower().strip()


def _normalize_phone(phone) -> str:
    import re
    return re.sub(r"[^\d]", "", str(phone or ""))


def _same_mongo_id(left, right) -> bool:
    return str(left or "") == str(right or "")


def _get_auth_cookie_options() -> dict:
    return {
        "httponly": True,
        "secure": IS_PRODUCTION,
        "samesite": "None" if IS_PRODUCTION else "Lax",
        "max_age": AUTH_COOKIE_MAX_AGE_SEC,
        "path": "/",
    }


def _get_token_from_request():
    auth_header = request.headers.get("Authorization", "")
    if auth_header and isinstance(auth_header, str):
        parts = auth_header.split(" ", 1)
        if len(parts) == 2 and parts[0] == "Bearer" and parts[1].strip():
            return parts[1].strip()
    return request.cookies.get(AUTH_COOKIE_NAME)


# ---------------------------------------------------------------------------
# REGISTER
# ---------------------------------------------------------------------------

def signup():
    try:
        data = request.get_json(silent=True) or {}
        email = data.get("email")
        password = data.get("password")
        phone_number = data.get("phoneNumber")
        first_name = data.get("firstName")
        last_name = data.get("lastName")

        normalized_email = _normalize_email(email)
        normalized_phone = _normalize_phone(phone_number)

        if not all([email, password, phone_number, first_name, last_name]):
            return jsonify({"message": "Missing fields"}), 400

        if not is_valid_email(normalized_email):
            return jsonify({"message": "Invalid email format"}), 400

        if not is_valid_phone(normalized_phone):
            return jsonify({"message": "Invalid phone number format"}), 400

        existing_by_email = find_user_by_email(normalized_email)
        existing_by_phone = find_user_by_phone_number(normalized_phone)

        if existing_by_email and existing_by_email.get("isVerified"):
            return jsonify({"message": "Email already registered"}), 409

        if existing_by_phone and existing_by_phone.get("isVerified"):
            return jsonify({"message": "Phone number already registered"}), 409

        if (
            existing_by_email
            and existing_by_phone
            and not _same_mongo_id(existing_by_email.get("_id"), existing_by_phone.get("_id"))
        ):
            return jsonify(
                {"message": "Pending registration conflict. Please try again later or contact support."}
            ), 409

        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()
        verification_token = str(uuid.uuid4())
        verification_expires = datetime.now(timezone.utc) + timedelta(seconds=VERIFICATION_TOKEN_MAX_AGE_SEC)
        pending_user = existing_by_phone or existing_by_email

        if pending_user:
            pending_user["firstName"] = str(first_name).strip()
            pending_user["lastName"] = str(last_name).strip()
            pending_user["email"] = normalized_email
            pending_user["phoneNumber"] = normalized_phone
            pending_user["password"] = password_hash
            pending_user["isVerified"] = False
            pending_user["verificationToken"] = verification_token
            pending_user["verificationExpires"] = verification_expires
            from models.user_model import _col as user_col, _now
            from bson import ObjectId
            user_col().update_one(
                {"_id": pending_user["_id"]},
                {"$set": {
                    "firstName": pending_user["firstName"],
                    "lastName": pending_user["lastName"],
                    "email": pending_user["email"],
                    "phoneNumber": pending_user["phoneNumber"],
                    "password": pending_user["password"],
                    "isVerified": False,
                    "verificationToken": verification_token,
                    "verificationExpires": verification_expires,
                    "updatedAt": _now(),
                }}
            )
        else:
            create_user({
                "firstName": str(first_name).strip(),
                "lastName": str(last_name).strip(),
                "email": normalized_email,
                "phoneNumber": normalized_phone,
                "password": password_hash,
                "isVerified": False,
                "verificationToken": verification_token,
                "verificationExpires": verification_expires,
            })

        try:
            send_verification_email(normalized_email, verification_token)
        except Exception as email_err:
            print(f"Verification email failed: {email_err}")

        return jsonify({"message": "Registration successful. Please verify your email."}), 201

    except Exception as err:
        print(f"SIGNUP ERROR: {err}")
        from pymongo.errors import DuplicateKeyError
        if isinstance(err, DuplicateKeyError):
            key_pattern = err.details.get("keyPattern", {}) if err.details else {}
            duplicated_field = list(key_pattern.keys())[0] if key_pattern else ""
            if duplicated_field == "phoneNumber":
                message = "Phone number already registered"
            elif duplicated_field == "email":
                message = "Email already registered"
            else:
                message = "User already registered"
            return jsonify({"message": message}), 409
        return jsonify({"message": "Server error"}), 500


# ---------------------------------------------------------------------------
# VERIFY
# ---------------------------------------------------------------------------

def _render_verify_html(status_code: int, title: str, message: str):
    html = f"""
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
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
            {title}
          </h2>

          <p style="margin:0;color:#334155;">
            {message}
          </p>

          <p style="margin:18px 0 0;color:#64748b;font-size:14px;">
            You can now close this tab and return to the application.
          </p>
        </div>
      </body>
    </html>
  """
    resp = make_response(html, status_code)
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    return resp


def verify():
    try:
        token = request.args.get("token", "").strip()

        if not token:
            return _render_verify_html(400, "Verification failed", "Invalid or missing verification token.")

        user = find_user_by_verification_token(token)

        if not user:
            return _render_verify_html(
                400, "Verification failed",
                "This verification link is invalid or has already been used."
            )

        if user.get("isVerified"):
            return _render_verify_html(
                200, "Account already verified",
                "Your account is already verified. You can log in."
            )

        expires = user.get("verificationExpires")
        if not expires or datetime.now(timezone.utc) > expires.replace(tzinfo=timezone.utc) if expires.tzinfo is None else datetime.now(timezone.utc) > expires:
            return _render_verify_html(
                400, "Verification link expired",
                "This verification link has expired. Please register again."
            )

        user["isVerified"] = True
        user["verificationToken"] = None
        user["verificationExpires"] = None
        save_user(user)

        account = find_account_by_user_id(user["_id"])
        if account:
            update_account_status(account["_id"], "ACTIVE")
        else:
            create_account(user["_id"], "ACTIVE")

        return _render_verify_html(
            200, "Account verified successfully",
            "Your account has been verified. You can now log in."
        )
    except Exception as err:
        print(f"VERIFY ERROR: {err}")
        return _render_verify_html(
            500, "Verification error",
            "An unexpected error occurred. Please try again later."
        )


# ---------------------------------------------------------------------------
# LOGIN
# ---------------------------------------------------------------------------

def login():
    try:
        data = request.get_json(silent=True) or {}
        email = data.get("email")
        password = data.get("password")

        if not email or not password:
            return jsonify({"message": "Email and password required"}), 400

        normalized_email = email.lower().strip()
        print(f"LOGIN EMAIL RAW: {email}")
        print(f"LOGIN EMAIL NORMALIZED: {normalized_email}")

        user = find_user_by_email_with_password(normalized_email)
        print(f"USER FOUND: {bool(user)}")
        print(f"HAS PASSWORD: {bool(user.get('password') if user else False)}")

        if not user or not user.get("password"):
            return jsonify({"message": "User not registered"}), 401

        if not user.get("isVerified"):
            return jsonify({"message": "Account not verified"}), 403

        stored_hash = user["password"]
        if isinstance(stored_hash, str):
            stored_hash = stored_hash.encode()
        if not bcrypt.checkpw(password.encode(), stored_hash):
            return jsonify({"message": "Invalid credentials"}), 401

        access_token = jwt.encode(
            {
                "userId": str(user["_id"]),
                "email": user["email"],
                "firstName": user.get("firstName", ""),
                "tokenVersion": int(user.get("tokenVersion") or 0),
                "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            },
            JWT_SECRET,
            algorithm="HS256",
        )

        cookie_opts = _get_auth_cookie_options()
        resp = make_response(jsonify({"accessToken": access_token}), 200)
        resp.set_cookie(AUTH_COOKIE_NAME, access_token, **cookie_opts)
        return resp

    except Exception as err:
        print(f"LOGIN ERROR: {err}")
        return jsonify({"message": "Server error"}), 500


# ---------------------------------------------------------------------------
# LOGOUT
# ---------------------------------------------------------------------------

def logout():
    try:
        token = _get_token_from_request()
        if token:
            try:
                payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
                if payload.get("userId"):
                    bump_token_version_by_id(payload["userId"])
            except Exception as err:
                print(f"Failed to revoke token on logout: {err}")

        cookie_opts = _get_auth_cookie_options()
        resp = make_response(jsonify({"message": "Logged out successfully"}), 200)
        resp.set_cookie(AUTH_COOKIE_NAME, "", expires=0, max_age=0,
                        httponly=cookie_opts["httponly"],
                        secure=cookie_opts["secure"],
                        samesite=cookie_opts["samesite"],
                        path=cookie_opts["path"])
        return resp

    except Exception as err:
        print(f"LOGOUT ERROR: {err}")
        return jsonify({"message": "Server error"}), 500


# ---------------------------------------------------------------------------
# FORGOT PASSWORD
# ---------------------------------------------------------------------------

def forgot_password():
    try:
        data = request.get_json(silent=True) or {}
        email = data.get("email")

        if not email:
            return jsonify({"message": "Email is required"}), 400

        normalized_email = str(email).lower().strip()
        user = find_user_by_email(normalized_email)

        if not user:
            return jsonify({"message": "User not registered"}), 404

        reset_token = str(uuid.uuid4())
        user["resetPasswordToken"] = reset_token
        user["resetPasswordExpires"] = datetime.now(timezone.utc) + timedelta(hours=1)
        save_user(user)

        send_password_reset_email(normalized_email, reset_token)

        return jsonify({"message": "Password reset email sent"}), 200

    except Exception as err:
        print(f"FORGOT PASSWORD ERROR: {err}")
        return jsonify({"message": "Server error"}), 500


# ---------------------------------------------------------------------------
# RESET PASSWORD (POST)
# ---------------------------------------------------------------------------

def reset_password():
    try:
        data = request.get_json(silent=True) or {}
        token = data.get("token")
        password = data.get("password")
        confirm_password = data.get("confirmPassword")

        if not all([token, password, confirm_password]):
            return jsonify({"message": "Missing fields"}), 400

        if password != confirm_password:
            return jsonify({"message": "Passwords do not match"}), 400

        user = find_user_by_reset_token(token)
        if not user:
            return jsonify({"message": "Invalid or expired token"}), 404

        expires = user.get("resetPasswordExpires")
        if not expires:
            return jsonify({"message": "Token expired"}), 400

        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires:
            return jsonify({"message": "Token expired"}), 400

        user["password"] = bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()
        user["resetPasswordToken"] = None
        user["resetPasswordExpires"] = None
        save_user(user)

        return jsonify({"message": "Password updated successfully"}), 200

    except Exception as err:
        print(f"RESET PASSWORD ERROR: {err}")
        return jsonify({"message": "Server error"}), 500


# ---------------------------------------------------------------------------
# OPEN RESET PASSWORD PAGE (GET)
# ---------------------------------------------------------------------------

def open_reset_password_page(token: str = ""):
    token = str(token or request.args.get("token") or "").strip()

    if not token:
        resp = make_response("Missing reset token", 400)
        resp.headers["Content-Type"] = "text/plain"
        return resp

    escaped_token = token.replace('"', "&quot;")

    html = f"""
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Reset Password | Bank One One</title>
        <style>
          :root {{
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
          }}
          * {{ box-sizing: border-box; }}
          body {{
            margin: 0;
            min-height: 100vh;
            font-family: "Segoe UI", Tahoma, Arial, sans-serif;
            color: var(--ink);
            background: linear-gradient(145deg, var(--bg-1), var(--bg-2));
            display: grid;
            place-items: center;
            padding: 20px;
          }}
          .card {{
            width: 100%;
            max-width: 460px;
            background: #fff;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 12px 30px rgba(15, 23, 42, 0.14);
          }}
          .head {{
            padding: 20px 24px;
            background: linear-gradient(90deg, var(--brand-1), var(--brand-2));
            color: #fff;
            font-weight: 700;
            font-size: 20px;
          }}
          .content {{ padding: 24px; }}
          .title {{ margin: 0 0 8px; font-size: 24px; }}
          .desc {{ margin: 0 0 18px; color: var(--muted); }}
          label {{ display: block; font-size: 14px; margin: 10px 0 6px; color: #1e293b; }}
          input {{
            width: 100%;
            border: 1px solid #cbd5e1;
            border-radius: 10px;
            padding: 11px 12px;
            font-size: 15px;
            outline: none;
          }}
          input:focus {{
            border-color: var(--brand-2);
            box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.16);
          }}
          button {{
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
          }}
          button:disabled {{ opacity: 0.7; cursor: not-allowed; }}
          .status {{
            display: none;
            margin-top: 12px;
            padding: 10px 12px;
            border-radius: 8px;
            font-size: 14px;
          }}
          .status.ok {{ display: block; color: var(--ok); background: var(--ok-bg); }}
          .status.err {{ display: block; color: var(--err); background: var(--err-bg); }}
        </style>
      </head>
      <body>
        <main class="card">
          <div class="head">Bank One One</div>
          <section class="content">
            <h1 class="title">Reset Password</h1>
            <p class="desc">Choose your new password to continue.</p>
            <form id="resetForm">
              <input type="hidden" id="token" value="{escaped_token}" />
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

          const showStatus = (type, message) => {{
            statusEl.className = 'status ' + type;
            statusEl.textContent = message;
          }};

          form.addEventListener('submit', async (event) => {{
            event.preventDefault();
            const token = document.getElementById('token').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            submitBtn.disabled = true;
            submitBtn.textContent = 'Updating...';
            statusEl.className = 'status';
            statusEl.textContent = '';

            try {{
              const response = await fetch('/api/v1/auth/reset-password', {{
                method: 'POST',
                headers: {{ 'Content-Type': 'application/json' }},
                body: JSON.stringify({{ token, password, confirmPassword }})
              }});
              const result = await response.json();

              if (!response.ok) {{
                showStatus('err', result.message || 'Password update failed');
              }} else {{
                showStatus('ok', 'Password updated successfully. You can now sign in.');
                form.reset();
              }}
            }} catch (error) {{
              showStatus('err', 'Network error. Please try again.');
            }} finally {{
              submitBtn.disabled = false;
              submitBtn.textContent = 'Update password';
            }}
          }});
        </script>
      </body>
    </html>
  """
    resp = make_response(html, 200)
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    return resp
