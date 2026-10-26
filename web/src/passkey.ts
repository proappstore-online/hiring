// Passkey step-up is OFF unless VITE_HIRING_PASSKEY_STEP_UP=on (see scripts/step-up-policy.mjs).
export const passkeyStepUpEnabled = ['on', 'true', '1'].includes(String(import.meta.env.VITE_HIRING_PASSKEY_STEP_UP ?? '').toLowerCase())
// PAS verifies WebAuthn on this app's relying party and updates its HttpOnly session.
const decode = (value: string): ArrayBuffer => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)).buffer
const encode = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
async function post(path: string, body: unknown = {}) {
  const response = await fetch('/.pas/auth/passkey/' + path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.code === 'no_passkey' ? 'Register a passkey first.' : result.error ?? 'Passkey verification failed. Sign in again and retry.')
  return result
}
export async function registerPublicationPasskey() {
  const options = await post('register/options')
  const credential = await navigator.credentials.create({ publicKey: { ...options, challenge: decode(options.challenge), user: { ...options.user, id: decode(options.user.id) }, excludeCredentials: options.excludeCredentials.map((c: { id: string }) => ({ ...c, id: decode(c.id) })) } }) as PublicKeyCredential | null
  if (!credential) throw new Error('Passkey registration cancelled.')
  const response = credential.response as AuthenticatorAttestationResponse
  const publicKey = response.getPublicKey()
  if (!publicKey) throw new Error('This authenticator cannot register a passkey.')
  await post('register', { id: credential.id, clientDataJSON: encode(response.clientDataJSON), authenticatorData: encode(response.getAuthenticatorData()), publicKey: encode(publicKey), publicKeyAlgorithm: response.getPublicKeyAlgorithm() })
}
export async function verifyPublicationPasskey() {
  if (!passkeyStepUpEnabled) return
  const options = await post('step-up/options')
  const credential = await navigator.credentials.get({ publicKey: { ...options, challenge: decode(options.challenge), allowCredentials: options.allowCredentials.map((c: { id: string }) => ({ ...c, id: decode(c.id) })) } }) as PublicKeyCredential | null
  if (!credential) throw new Error('Passkey verification cancelled.')
  const response = credential.response as AuthenticatorAssertionResponse
  await post('step-up', { id: credential.id, clientDataJSON: encode(response.clientDataJSON), authenticatorData: encode(response.authenticatorData), signature: encode(response.signature) })
}
