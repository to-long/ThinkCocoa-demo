/**
 * Transactional email sender.
 *
 * All email in the app is transactional (password reset, magic link).
 * We use Resend (https://resend.com) which speaks REST via a single
 * API key. Templates are inline-HTML string literals — they never
 * need to be re-rendered dynamically and staying dependency-free
 * (no react-email) keeps cold-start + bundle small.
 *
 * Fallback: if `RESEND_API_KEY` is unset we log the outgoing email
 * to stdout instead of throwing, so a fresh dev checkout without an
 * API key still boots and manual QA of the sign-in flows still
 * works (paste the link from the terminal into the browser). Prod
 * MUST set the key — `app.ts` doesn't hard-fail on absence because
 * the majority of endpoints don't need email at all.
 */

import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Kuana Data <no-reply@kuanadata.com>';
const APP_NAME = 'Kuana Data';

// Instantiate lazily so importing this module doesn't crash at boot
// when the key is absent (dev machines without email creds).
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alt body — improves deliverability. Auto-derived
   *  from the HTML if the caller doesn't provide one. */
  text?: string;
}

/** Fire-and-forget send. Never throws — errors are logged so a mail
 *  provider outage can't break the auth flow (better-auth still
 *  returns success to the client, but the user won't get the link). */
export async function sendEmail({ to, subject, html, text }: SendArgs): Promise<void> {
  if (!resend) {
    console.log(`[email:fallback] to=${to} subject=${JSON.stringify(subject)}`);
    console.log(html);
    return;
  }
  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html,
      text: text ?? stripHtml(html),
    });
    if (error) {
      console.error(`[email:resend] send failed to=${to}`, error);
    }
  } catch (err) {
    console.error(`[email:resend] throw to=${to}`, err);
  }
}

// ── Templates ────────────────────────────────────────────────────
// Shared shell so branding stays in one place. Inline styles because
// most mail clients strip `<style>` blocks; the max-width + padding
// keep the CTA button visible on both desktop and mobile Gmail.

function shell(bodyInnerHtml: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e7e5e4;border-radius:8px;max-width:560px;">
        <tr><td style="padding:32px 32px 8px 32px;">
          <div style="font-size:20px;font-weight:600;color:#1c1917;">${APP_NAME}</div>
        </td></tr>
        <tr><td style="padding:8px 32px 32px 32px;font-size:14px;line-height:1.55;color:#44403c;">
          ${bodyInnerHtml}
        </td></tr>
        <tr><td style="padding:0 32px 24px 32px;font-size:12px;color:#a8a29e;border-top:1px solid #f5f5f4;padding-top:16px;">
          If you didn't request this, you can safely ignore this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function ctaButton(url: string, label: string): string {
  return `<a href="${url}"
    style="display:inline-block;background:#1c1917;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:16px 0;">
    ${label}
  </a>
  <p style="font-size:12px;color:#78716c;word-break:break-all;">
    Or paste this link into your browser:<br>
    <span style="color:#44403c;">${url}</span>
  </p>`;
}

/** Better-auth reset-password link email. */
export function renderResetPasswordEmail(args: { userName?: string | null; url: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = args.userName ? `Hi ${escapeHtml(args.userName)},` : 'Hi,';
  const html = shell(`
    <p style="margin:0 0 12px 0;">${greeting}</p>
    <p style="margin:0 0 8px 0;">
      We received a request to reset the password on your ${APP_NAME} account.
      Click the button below to choose a new password. The link is valid for
      1 hour.
    </p>
    ${ctaButton(args.url, 'Reset password')}
  `);
  const text = `${greeting}\n\nReset your ${APP_NAME} password:\n${args.url}\n\nIf you didn't request this, ignore this email.`;
  return { subject: `Reset your ${APP_NAME} password`, html, text };
}

/** Better-auth magic-link sign-in email. */
export function renderMagicLinkEmail(args: { url: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const html = shell(`
    <p style="margin:0 0 8px 0;">
      Click the button below to sign in to ${APP_NAME}. The link is valid
      for 5 minutes and can only be used once.
    </p>
    ${ctaButton(args.url, `Sign in to ${APP_NAME}`)}
  `);
  const text = `Sign in to ${APP_NAME}:\n${args.url}\n\nThe link expires in 5 minutes.`;
  return { subject: `Your ${APP_NAME} sign-in link`, html, text };
}

// ── Helpers ──────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Very small HTML → text fallback for the `text` alt-body. Just
 *  strips tags + collapses whitespace; good enough for the two
 *  short templates above. */
function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
