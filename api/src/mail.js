import nodemailer from "nodemailer";

export async function sendAccountCreated({ email, displayName }) {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;
  if (!host || !from) {
    return false;
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" }
      : undefined,
  });
  await transport.sendMail({
    from,
    to: email,
    subject: "Your account is ready",
    text: [
      `Hello ${displayName},`,
      "",
      "Your account has been created.",
      "Sign in with this email to compare prices and share a shopping list.",
      "",
      "If you did not create this account, you can ignore this message.",
    ].join("\n"),
  });
  return true;
}
