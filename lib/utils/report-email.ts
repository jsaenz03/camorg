/**
 * Default email draft for the case-report handoff.
 *
 * The report page's compose dialog prefills these: same subject wording as
 * the Rust side (report.rs draft_subject), and a styled HTML body that
 * mirrors the paper report's design language (teal brand rule, zinc
 * neutrals, DD/MM/YYYY facts table). Colours follow the app's current
 * theme at compose time (Settings/toggle via next-themes) — dark app,
 * dark-tinted message. Keeping the template here means the clinician sees
 * (and edits) exactly what their mail client will receive; the Rust default
 * remains only as the fallback for callers that send no custom draft (it
 * stays light-themed).
 *
 * Email-safe markup: tables with inline styles only (no flexbox/grid —
 * Outlook), a 600px card, and system fonts, so the message renders the
 * same across Mail, Outlook and webmail.
 */

export interface EmailDraft {
  /** Patient email (or blank); only prefills the To: line. */
  recipient: string;
  subject: string;
  /** Full HTML document — handed to the mail client verbatim. */
  bodyHtml: string;
}

/** Report fields the template interpolates (matches ReportRequest). */
export interface ReportEmailFields {
  patientName: string;
  /** Same nullable shape as the page's preparedBy state; null reads as Clinician. */
  preparedBy: string | null;
  preparedAt: string;
  consentLabel: string;
  /** False when consent is expired/missing — the value reads in the alert colour. */
  consentValid: boolean;
  photoCountLabel: string;
  timelineLabel: string | null;
}

/** Escape free text interpolated into the template (names are free text). */
function htmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inline-style palettes mirroring the app's zinc tokens (Tailwind zinc)
 *  plus the brand teal (#007B82, the same accent the PDF report carries). */
const THEME_PALETTES = {
  light: {
    pageBg: '#f4f4f5',
    card: '#ffffff',
    border: '#e4e4e7',
    chipBg: '#fafafa',
    text: '#18181b',
    muted: '#71717a',
    accent: '#007B82',
    accentText: '#007B82',
    alert: '#b3261e',
  },
  dark: {
    pageBg: '#09090b',
    card: '#18181b',
    border: '#27272a',
    chipBg: '#09090b',
    text: '#fafafa',
    muted: '#a1a1aa',
    accent: '#007B82',
    // The brand teal is too dark for text on the zinc-900 card; the light
    // variant keeps the accent readable (AA) while bars stay brand teal.
    accentText: '#45c8cd',
    alert: '#f87171',
  },
} as const;

export type EmailTheme = keyof typeof THEME_PALETTES;

/** Clinic branding carried into the email header. The logo rides inside
 *  the message as a base64 data URI — no hosting — which Apple Mail and
 *  Thunderbird render; Outlook desktop and Gmail strip data URIs, where the
 *  alt text (the clinic name) takes over. Only data: URIs are accepted so a
 *  tampered settings row can never turn the email into an external-image
 *  beacon. */
export interface EmailBranding {
  logoDataUrl?: string | null;
  orgName?: string;
}

/** Attachment file name, matching the Rust side's draft_attachment_name
 *  (same character set blanked as the webview's sanitiseFileToken). */
function attachmentName(patientName: string): string {
  const cleaned = patientName.replace(/[/\\?%*:|"<>]/g, ' ');
  return `Camog case report - ${cleaned.split(/\s+/).filter(Boolean).join(' ')}.pdf`;
}

export function buildDefaultEmailDraft(
  fields: ReportEmailFields,
  recipient = '',
  theme: EmailTheme = 'light',
  branding: EmailBranding = {}
): EmailDraft {
  const p = THEME_PALETTES[theme];
  const name = htmlEscape(fields.patientName);
  const logo =
    typeof branding.logoDataUrl === 'string' && branding.logoDataUrl.startsWith('data:image/')
      ? `<img src="${htmlEscape(branding.logoDataUrl)}" alt="${htmlEscape(branding.orgName ?? 'Clinic logo')}" width="36" height="36" style="display: block; height: 36px; width: auto; margin: 0 0 16px; border: 0;" />`
      : '';

  // Facts table rows: label/value pairs with hairline separators between
  // (not around) rows. Consent reads in the alert colour when not valid,
  // matching the paper report.
  const rows: Array<{ label: string; value: string; alert?: boolean }> = [
    { label: 'Prepared by', value: htmlEscape(fields.preparedBy ?? 'Clinician') },
    { label: 'Prepared', value: htmlEscape(fields.preparedAt) },
    { label: 'Photos', value: htmlEscape(fields.photoCountLabel) },
  ];
  if (fields.timelineLabel) {
    rows.push({ label: 'Timeline', value: htmlEscape(fields.timelineLabel) });
  }
  rows.push({
    label: 'Photo consent',
    value: htmlEscape(fields.consentLabel),
    alert: !fields.consentValid,
  });

  const rowsHtml = rows
    .map(
      (row, i) => `
        <tr>
          <td style="padding: 10px 14px; width: 45%; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${p.muted}; border-top: ${i === 0 ? 'none' : `1px solid ${p.border}`};">${row.label}</td>
          <td style="padding: 10px 14px; font-size: 13px; font-weight: 600; color: ${row.alert ? p.alert : p.text}; border-top: ${i === 0 ? 'none' : `1px solid ${p.border}`};">${row.value}</td>
        </tr>`
    )
    .join('\n');

  return {
    recipient,
    subject: `Clinical photo report — ${fields.patientName}`,
    bodyHtml: `<html>
  <body style="margin: 0; padding: 24px 12px; background-color: ${p.pageBg}; color: ${p.text}; font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.5;">
    <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style="max-width: 600px; margin: 0 auto;">
      <tr>
        <td style="background-color: ${p.card}; border: 1px solid ${p.border}; border-radius: 12px;">
          <table role="presentation" width="100%" cellPadding="0" cellSpacing="0">
            <tr>
              <td style="height: 4px; background-color: ${p.accent}; font-size: 0; line-height: 0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding: 28px 32px 0;">
                ${logo}
                <p style="margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: ${p.accentText};">Camog · Clinical photo documentation</p>
                <h1 style="margin: 10px 0 0; font-size: 20px; line-height: 1.3; color: ${p.text};">Patient case report</h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 32px 28px;">
                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: ${p.text};">A clinical photo report for <strong>${name}</strong> is attached as a PDF.</p>
                <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style="margin-top: 20px; border: 1px solid ${p.border}; border-radius: 8px; border-collapse: separate; border-spacing: 0;">${rowsHtml}
                </table>
                <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style="margin-top: 16px; border: 1px solid ${p.border}; border-radius: 8px; background-color: ${p.chipBg};">
                  <tr>
                    <td style="padding: 12px 14px;">
                      <p style="margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${p.muted};">Attached</p>
                      <p style="margin: 2px 0 0; font-size: 13px; font-weight: 600; color: ${p.text};">${htmlEscape(attachmentName(fields.patientName))}</p>
                    </td>
                  </tr>
                </table>
                <p style="margin: 24px 0 0; font-size: 12px; line-height: 1.6; color: ${p.muted};">Generated locally with Camog. All photos and clinical notes remain stored on the treating clinician&apos;s device; Camog does not transmit patient data.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}
