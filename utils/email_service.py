"""
Email service using Brevo (formerly Sendinblue) REST API.
"""

import httpx
from config.settings import BREVO_API_KEY, MAIL_FROM, MAIL_FROM_NAME, APP_BASE_URL, FRONTEND_BASE_URL

BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email"


def _email_layout(content: str) -> str:
    from datetime import date
    year = date.today().year
    return f"""
  <div style="background:#f5f7fa; padding:40px 0; font-family:Arial, sans-serif">
    <div style="
      max-width:600px;
      margin:auto;
      background:#ffffff;
      border-radius:10px;
      overflow:hidden;
      box-shadow:0 4px 12px rgba(0,0,0,0.08)
    ">
      <div style="
        background:linear-gradient(90deg,#1a73e8,#0b4fa2);
        padding:20px;
        text-align:center;
      ">
        <strong style="color:white;font-size:20px">
          Bank One One
        </strong>
      </div>

      <div style="padding:30px">
        {content}
      </div>

      <div style="
        background:#f0f2f5;
        padding:16px;
        text-align:center;
        font-size:12px;
        color:#666
      ">
        &copy; {year} Bank One One &middot; Secure Banking
      </div>
    </div>
  </div>
"""


def _send_email(*, to: str, subject: str, html: str) -> None:
    payload = {
        "sender": {"email": MAIL_FROM, "name": MAIL_FROM_NAME or "Bank One One"},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html,
    }

    response = httpx.post(
        BREVO_SEND_URL,
        json=payload,
        headers={"api-key": BREVO_API_KEY, "Content-Type": "application/json"},
        timeout=15,
    )

    if not response.is_success:
        error_text = response.text
        print(f"❌ Brevo error: status={response.status_code}, data={error_text}")
        raise RuntimeError(f"Brevo error: {error_text}")

    result = response.json()
    print(f"✅ Brevo response: {result}")


def send_verification_email(email: str, token: str) -> None:
    backend_base_url = APP_BASE_URL
    verification_link = f"{backend_base_url}/api/v1/auth/verify?token={token}"

    content = f"""
    <h2 style="color:#1a73e8; text-align:center">
      Verify your account
    </h2>

    <p>Hello <strong>{email}</strong>,</p>

    <p>
      Welcome to <strong>Bank One One</strong>.
      Please verify your email to activate your account.
    </p>

    <div style="text-align:center; margin:30px 0">
      <a href="{verification_link}" style="
        background:#1a73e8;
        color:#ffffff;
        padding:14px 26px;
        border-radius:6px;
        text-decoration:none;
        font-size:16px;">
        Verify Account
      </a>
    </div>
  """

    _send_email(
        to=email,
        subject="Verify your Bank One One account",
        html=_email_layout(content),
    )


def send_password_reset_email(email: str, token: str) -> None:
    from urllib.parse import quote

    app_base = (APP_BASE_URL or "").rstrip("/")
    frontend_base = (FRONTEND_BASE_URL or "").rstrip("/")
    encoded_token = quote(token, safe="")

    if app_base:
        reset_link = f"{app_base}/api/v1/auth/reset-password/{encoded_token}"
    elif frontend_base:
        reset_link = f"{frontend_base}/reset-password/{encoded_token}"
    else:
        raise RuntimeError("Neither APP_BASE_URL nor FRONTEND_BASE_URL is configured")

    content = f"""
    <h2 style="color:#1a73e8; text-align:center">
      Reset your password
    </h2>

    <p>Hello <strong>{email}</strong>,</p>

    <p>
      We received a request to reset your password.
      Click the button below to continue.
    </p>

    <div style="text-align:center; margin:30px 0">
      <a href="{reset_link}" style="
        background:#1a73e8;
        color:#ffffff;
        padding:14px 26px;
        border-radius:6px;
        text-decoration:none;
        font-size:16px;">
        Reset Password
      </a>
    </div>
  """

    _send_email(
        to=email,
        subject="Reset your Bank One One password",
        html=_email_layout(content),
    )
