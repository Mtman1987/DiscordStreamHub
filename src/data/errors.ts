'use client';

type User = {
  displayName?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  phoneNumber?: string | null;
  uid: string;
  providerData?: Array<{ providerId?: string; uid: string }>;
  tenantId?: string | null;
};

type SecurityRuleContext = {
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete' | 'write';
  requestResourceData?: any;
};

interface DataAuthToken {
  name: string | null;
  email: string | null;
  email_verified: boolean;
  phone_number: string | null;
  sub: string;
  Data: {
    identities: Record<string, string[]>;
    sign_in_provider: string;
    tenant: string | null;
  };
}

interface DataAuthObject {
  uid: string;
  token: DataAuthToken;
}

interface SecurityRuleRequest {
  auth: DataAuthObject | null;
  method: string;
  path: string;
  resource?: {
    data: any;
  };
}

/**
 * Builds a security-rule-compliant auth object from the Data User.
 * @param currentUser The currently authenticated Data user.
 * @returns An object that mirrors request.auth in security rules, or null.
 */
function buildAuthObject(currentUser: User | null): DataAuthObject | null {
  if (!currentUser) {
    return null;
  }

  const providerData = currentUser.providerData ?? [];

  const token: DataAuthToken = {
    name: currentUser.displayName ?? null,
    email: currentUser.email ?? null,
    email_verified: currentUser.emailVerified ?? false,
    phone_number: currentUser.phoneNumber ?? null,
    sub: currentUser.uid,
    Data: {
      identities: providerData.reduce((acc, p) => {
        if (p.providerId) {
          acc[p.providerId] = [p.uid];
        }
        return acc;
      }, {} as Record<string, string[]>),
      sign_in_provider: providerData[0]?.providerId || 'custom',
      tenant: currentUser.tenantId ?? null,
    },
  };

  return {
    uid: currentUser.uid,
    token: token,
  };
}

/**
 * Builds the complete, simulated request object for the error message.
 * It safely tries to get the current authenticated user.
 * @param context The context of the failed store operation.
 * @returns A structured request object.
 */
function buildRequestObject(context: SecurityRuleContext): SecurityRuleRequest {
  const currentUser = null;
  const authObject: DataAuthObject | null = currentUser ? buildAuthObject(currentUser) : null;

  return {
    auth: authObject,
    method: context.operation,
    path: `/databases/(default)/documents/${context.path}`,
    resource: context.requestResourceData ? { data: context.requestResourceData } : undefined,
  };
}

/**
 * Builds the final, formatted error message for the LLM.
 * @param requestObject The simulated request object.
 * @returns A string containing the error message and the JSON payload.
 */
function buildErrorMessage(requestObject: SecurityRuleRequest): string {
  return `Missing or insufficient permissions: The following request was denied by store Security Rules:
${JSON.stringify(requestObject, null, 2)}`;
}

/**
 * A custom error class designed to be consumed by an LLM for debugging.
 * It structures the error information to mimic the request object
 * available in store Security Rules.
 */
export class DataPermissionError extends Error {
  public readonly request: SecurityRuleRequest;

  constructor(context: SecurityRuleContext) {
    const requestObject = buildRequestObject(context);
    super(buildErrorMessage(requestObject));
    this.name = 'DataError';
    this.request = requestObject;
  }
}
