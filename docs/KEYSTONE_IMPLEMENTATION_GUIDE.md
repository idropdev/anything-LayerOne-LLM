# Keystone Service Identity Implementation Guide

## Overview

This guide provides instructions for Keystone Core API developers on how to implement service identity token minting and attach tokens when calling AnythingLLM endpoints.

## Token Minting

### GCP Mode (Production)

Use Google Application Default Credentials (ADC) to mint OIDC ID tokens:

```typescript
import { GoogleAuth } from 'google-auth-library';

async function getAnythingLLMServiceToken(): Promise<string> {
  const audience = process.env.ANYTHINGLLM_SERVICE_AUDIENCE; // e.g., "anythingllm-internal"
  
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(audience);
  const idToken = await client.idTokenProvider.fetchIdToken(audience);
  
  return idToken;
}
```

### Local JWT Mode (Development)

Sign RS256 JWTs for local development:

```typescript
import jwt from 'jsonwebtoken';

function getAnythingLLMServiceToken(): string {
  const privateKey = process.env.KEYSTONE_SERVICE_PRIVATE_KEY;
  const audience = process.env.ANYTHINGLLM_SERVICE_AUDIENCE;
  
  const token = jwt.sign(
    {
      iss: 'keystone-service',
      sub: 'keystone-service',
      aud: audience,
      role: 'admin',
      scope: 'workspaces:create workspaces:delete rag:query',
      sid: require('uuid').v4(),
    },
    privateKey,
    {
      algorithm: 'RS256',
      expiresIn: '5m',
    }
  );
  
  return token;
}
```

## Making Requests to AnythingLLM

Attach the service identity token in the `Authorization` header:

```typescript
async function callAnythingLLM(endpoint: string, options: RequestInit = {}) {
  const token = await getAnythingLLMServiceToken();
  
  const response = await fetch(`${ANYTHINGLLM_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Request-Id': require('uuid').v4(),
      'X-Client-Service': 'keystone',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    throw new Error(`AnythingLLM request failed: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}
```

## Environment Variables (Keystone)

**GCP Mode:**
```env
ANYTHINGLLM_SERVICE_AUTH_MODE=gcp
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal
```

**Local JWT Mode:**
```env
ANYTHINGLLM_SERVICE_AUTH_MODE=local_jwt
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal
KEYSTONE_SERVICE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
```

## Available Endpoints

All `/v1/admin/*` endpoints require service identity authentication. See [SERVICE_TO_SERVICE_AUTHENTICATION.md](./SERVICE_TO_SERVICE_AUTHENTICATION.md) for the complete list.

Example test endpoint:
```typescript
const result = await callAnythingLLM('/v1/admin/is-multi-user-mode', {
  method: 'GET',
});
```

## Error Handling

Handle authentication failures appropriately:

```typescript
try {
  const result = await callAnythingLLM('/v1/admin/users');
  // Process result
} catch (error) {
  if (error.message.includes('401')) {
    // Token invalid or expired - may need to refresh
    console.error('Service identity token rejected');
  } else if (error.message.includes('403')) {
    // Service actor account suspended
    console.error('Service actor account suspended');
  } else {
    // Other error
    console.error('Request failed:', error);
  }
}
```

## Token Caching

Tokens may be cached briefly (≤ 5 minutes) but must respect expiration. GCP ID tokens are typically valid for 1 hour, local JWTs for 5 minutes.

## Security Notes

1. **Fail-Closed**: If token cannot be minted, do not call AnythingLLM unauthenticated
2. **No PHI in Tokens**: Service identity tokens should not contain any PHI
3. **Secret Management**: Use GCP Secret Manager for production secrets (TODO)
4. **Token Rotation**: Ensure tokens are refreshed before expiration

