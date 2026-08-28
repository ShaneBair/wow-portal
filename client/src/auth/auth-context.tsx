import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
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
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true
  });
  const identity = sessionQuery.data?.authenticated
    ? sessionQuery.data.account.username
    : sessionQuery.data
      ? "anonymous"
      : undefined;
  const previousIdentity = useRef<string | undefined>(undefined);

  function clearIdentityScopedQueries(): void {
    for (const queryKey of [["protected"], ["account-visible"]] as const) {
      void queryClient.cancelQueries({ queryKey });
      queryClient.removeQueries({ queryKey, type: "inactive" });
      void queryClient.resetQueries({ queryKey, type: "active" });
    }
  }

  useEffect(() => {
    if (
      previousIdentity.current !== undefined &&
      identity !== undefined &&
      previousIdentity.current !== identity
    ) {
      clearIdentityScopedQueries();
    }
    if (identity !== undefined) {
      previousIdentity.current = identity;
    }
  }, [identity]);

  function setAuthenticated(session: AuthenticatedSession): void {
    queryClient.setQueryData(authSessionQueryKey, session);
    clearIdentityScopedQueries();
  }

  function setSignedOut(): void {
    queryClient.setQueryData<PortalSession>(authSessionQueryKey, { authenticated: false });
    clearIdentityScopedQueries();
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
