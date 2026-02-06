import fs from 'fs';
import path from 'path';
import { Resend } from 'resend';


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
        <img
          src="cid:bank-logo"
          alt="Bank One One"
          style="max-width:140px"
        />
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

let resendClient;

const getResendClient = () => {
  const apiKey = process.env.RESEND_API_KEY;
  console.log("apikey:" , apiKey);
  if (!apiKey) {
    throw new Error(
      'Missing RESEND_API_KEY. Set it in your environment to send email.'
    );
  }

  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }

  return resendClient;
};

const getFromAddress = () => {
  const raw = process.env.MAIL_FROM || 'Acme <onboarding@resend.dev>';
  return raw.includes('<') ? raw : `Bank One One <${raw}>`;
};

const getLogoAttachment = () => {
  const logoPath = path.join(process.cwd(), 'logo', 'bank-one-one-logo.png');
  const content = fs.readFileSync(logoPath).toString('base64');

  return {
    content,
    filename: 'bank-one-one-logo.png',
    contentId: 'bank-logo'
  };
};

const sendEmail = async ({ to, subject, html }) => {
  const resend = getResendClient();
  const { data, error } = await resend.emails.send({
    from: getFromAddress(),
    to: [to],
    subject,
    html
   // attachments: [getLogoAttachment()]
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }

  return data;
};

/* ======================
   Verification Email
====================== */

export const sendVerificationEmail = async (email, token) => {
  console.log('📨 Verification token:', token);
  
  const backendBaseUrl = process.env.APP_BASE_URL;
  console.log("backendBaseUrl:", backendBaseUrl);
  const verificationLink = `${backendBaseUrl}/api/v1/auth/verify?token=${token}`;

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
      <a
        href="${verificationLink}"
        style="
          background:#1a73e8;
          color:#ffffff;
          padding:14px 26px;
          border-radius:6px;
          text-decoration:none;
          font-size:16px;
        "
      >
        Verify Account
      </a>
    </div>
  `;
    console.log(email);
  const result = await sendEmail({

    to: email,
    subject: 'Verify your Bank One One account',
    html: emailLayout(content)
  });
  console.log("sendEmail:", result);
};

/* ======================
   Password Reset Email
====================== */

export const sendPasswordResetEmail = async (email, token) => {
  console.log('🔐 Reset token:', token);

  const frontendBaseUrl =
    process.env.FRONTEND_BASE_URL || process.env.APP_BASE_URL;
  const resetLink = `${frontendBaseUrl}/reset-password?token=${token}`;

  const content = `
    <h2 style="color:#1a73e8; text-align:center">
      Reset your password
    </h2>

    <p>Hello <strong>${email}</strong>,</p>

    <p>
      We received a request to reset your password.
      Click the button below to set a new password.
    </p>

    <div style="text-align:center; margin:30px 0">
      <a
        href="${resetLink}"
        style="
          background:#1a73e8;
          color:#ffffff;
          padding:14px 26px;
          border-radius:6px;
          text-decoration:none;
          font-size:16px;
        "
      >
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
