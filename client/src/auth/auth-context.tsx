import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import {
  getPortalSession,
  type AuthenticatedSession,
  type PortalSession
} from "../api/auth.js";

export const authSessionQueryKey = ["auth", "session"] as const;

interface AuthContextValue {
  session: PortalSession | undefined;
  isLoading: boolean;
  isError: boolean;
  setAuthenticated(session: AuthenticatedSession): void;
  setSignedOut(): void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: authSessionQueryKey,
    queryFn: ({ signal }) => getPortalSession(signal),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false
  });

  function setAuthenticated(session: AuthenticatedSession): void {
    queryClient.setQueryData(authSessionQueryKey, session);
    queryClient.removeQueries({ queryKey: ["protected"] });
  }

  function setSignedOut(): void {
    queryClient.setQueryData<PortalSession>(authSessionQueryKey, { authenticated: false });
    queryClient.removeQueries({ queryKey: ["protected"] });
  }

  return (
    <AuthContext.Provider value={{
      session: sessionQuery.data,
      isLoading: sessionQuery.isPending,
      isError: sessionQuery.isError,
      setAuthenticated,
      setSignedOut
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return value;
}
