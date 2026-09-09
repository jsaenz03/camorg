/**
 * Hosted purchase page (Stripe checkout → licence key by email). The app
 * never handles payments — this opens in the system browser. Served by the
 * activation worker (activation-server/public/buy.html); fulfilment is
 * specs/004-licence-purchase.
 */
export const BUY_LICENCE_URL = 'https://camog-license.cliniciq.com.au/buy';
