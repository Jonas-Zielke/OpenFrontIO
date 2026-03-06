import { TokenPayload } from "../core/ApiSchemas";
import { generateCryptoRandomUUID } from "./Utils";

export type UserAuth = { jwt: string; claims: TokenPayload } | false;

const PERSISTENT_ID_KEY = "player_persistent_id";

export function discordLogin() {
  console.warn("Authentication is disabled in this build.");
}

export async function tempTokenLogin(_token: string): Promise<string | null> {
  return null;
}

export async function getAuthHeader(): Promise<string> {
  return "";
}

export async function logOut(_allSessions: boolean = false): Promise<boolean> {
  localStorage.removeItem(PERSISTENT_ID_KEY);
  return true;
}

export async function isLoggedIn(): Promise<boolean> {
  return false;
}

export async function userAuth(
  _shouldRefresh: boolean = true,
): Promise<UserAuth> {
  return false;
}

export async function sendMagicLink(_email: string): Promise<boolean> {
  return false;
}

// WARNING: DO NOT EXPOSE THIS ID
export async function getPlayToken(): Promise<string> {
  return getPersistentIDFromLocalStorage();
}

// WARNING: DO NOT EXPOSE THIS ID
export function getPersistentID(): string {
  return getPersistentIDFromLocalStorage();
}

// WARNING: DO NOT EXPOSE THIS ID
function getPersistentIDFromLocalStorage(): string {
  // Try to get existing localStorage
  const value = localStorage.getItem(PERSISTENT_ID_KEY);
  if (value) return value;

  // If no localStorage exists, create new ID and set localStorage
  const newID = generateCryptoRandomUUID();
  localStorage.setItem(PERSISTENT_ID_KEY, newID);

  return newID;
}
