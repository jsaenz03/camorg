/**
 * Activation server public key (Ed25519, hex).
 *
 * Verifies the activation token the licence server returns at activation
 * (base64url(payload).base64url(signature), same shape as licence keys) so
 * the app can honour a seat offline for the licence's whole term. The pair
 * private key is the TOKEN_SIGNING_KEY wrangler secret — generated once by
 * node activation-server/scripts/gen-token-keys.mjs, never committed.
 *
 * Rotation: deploy a new TOKEN_SIGNING_KEY secret, embed the new public key
 * here, and release — devices re-activate (one online check) to pick up a
 * token under the new key.
 */
export const ACTIVATION_PUBLIC_KEY_HEX = '46ce6d999f1f08c6dd840670559f86d99f0e85726b238c354de549e451d69ba3';
