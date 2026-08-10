import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

export interface AuthState {
  /** "loading" only ever appears while the stored session is being restored. */
  status: "loading" | "signedIn" | "signedOut";
  session: Session | null;
  user: User | null;
}

export const SIGNED_OUT: AuthState = {
  status: "signedOut",
  session: null,
  user: null,
};

export const AuthContext = createContext<AuthState>(SIGNED_OUT);

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
