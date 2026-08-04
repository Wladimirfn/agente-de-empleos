export { encrypt, decrypt, generateMasterKey } from './aes-gcm.js';
export { getOrCreateMasterKey, rotateMasterKey } from './master-key.js';
export {
  listCredentials,
  saveCredential,
  deleteCredential,
  loadCredentialPlaintext,
  recordLoginStatus,
  persistStorageState,
} from './credentials.js';
export type { CredentialSummary, CredentialPlaintext, LoginStatus } from './credentials.js';
