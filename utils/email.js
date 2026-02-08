import fetch from 'node-fetch';

/* ======================
   Email Layout (GLOBAL)
====================== */
const emailLayout = (content) => `
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
        ${content}
      </div>

      <div style="
        background:#f0f2f5;
        padding:16px;
        text-align:center;
        font-size:12px;
        color:#666
      ">
        © ${new Date().getFullYear()} Bank One One · Secure Banking
      </div>
    </div>
  </div>
`;

/* ======================
   Generic Send Function
====================== */
const sendEmail = async ({ to, subject, html }) => {
  console.log('📨 Sending email via Brevo', {
    to,
    from: process.env.MAIL_FROM,
    hasApiKey: Boolean(process.env.BREVO_API_KEY)
  });

  const payload = {
    sender: {
      email: process.env.MAIL_FROM,
      name: process.env.MAIL_FROM_NAME || 'Bank One One'
    },
    to: [{ email: to }],
    subject,
    htmlContent: html
  };

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error('❌ Brevo error:', {
      status: res.status,
      data: errorText
    });
    throw new Error(`Brevo error: ${errorText}`);
  }

  const result = await res.json();
  console.log('✅ Brevo response:', result);
};

/* ======================
   Verification Email
====================== */
export const sendVerificationEmail = async (email, token) => {
  const backendBaseUrl = process.env.APP_BASE_URL;
  const verificationLink =
    `${backendBaseUrl}/api/v1/auth/verify?token=${token}`;

  const content = `
    <h2 style="color:#1a73e8; text-align:center">
      Verify your account
    </h2>

    <p>Hello <strong>${email}</strong>,</p>

    <p>
      Welcome to <strong>Bank One One</strong>.
      Please verify your email to activate your account.
    </p>

    <div style="text-align:center; margin:30px 0">
      <a href="${verificationLink}" style="
        background:#1a73e8;
        color:#ffffff;
        padding:14px 26px;
        border-radius:6px;
        text-decoration:none;
        font-size:16px;">
        Verify Account
      </a>
    </div>
  `;

  await sendEmail({
    to: email,
    subject: 'Verify your Bank One One account',
    html: emailLayout(content)
  });
};

/* ======================
   Password Reset Email
====================== */
export const sendPasswordResetEmail = async (email, token) => {
  const frontendBaseUrl =
    process.env.FRONTEND_BASE_URL || process.env.APP_BASE_URL;

  const resetLink =
    `${frontendBaseUrl}/reset-password?token=${token}`;

  const content = `
    <h2 style="color:#1a73e8; text-align:center">
      Reset your password
    </h2>

    <p>Hello <strong>${email}</strong>,</p>

    <p>
      We received a request to reset your password.
      Click the button below to continue.
    </p>

    <div style="text-align:center; margin:30px 0">
      <a href="${resetLink}" style="
        background:#1a73e8;
        color:#ffffff;
        padding:14px 26px;
        border-radius:6px;
        text-decoration:none;
        font-size:16px;">
        Reset Password
      </a>
    </div>
  `;

  await sendEmail({
    to: email,
    subject: 'Reset your Bank One One password',
    html: emailLayout(content)
  });
};
