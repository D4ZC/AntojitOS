export interface AuthContext {
  sessionId: string;
  siteId: string;
  userId: string;
  terminalId: string;
  displayName: string;
  permissions: string[];
}

export interface RequestWithAuth {
  auth: AuthContext;
  headers: Record<string, string | string[] | undefined>;
}

