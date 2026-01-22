# HTTP Status Code Guidelines

This document describes the standardized HTTP status codes used across the AnythingLLM API, particularly for service-to-service endpoints used by Keystone Core API.

## Principles

We follow REST API best practices for status codes:

- **201 Created**: POST requests that successfully create a new resource and return it in the response body
- **204 No Content**: Successful operations that don't return content (DELETE, some updates)
- **200 OK**: Successful operations that return content (GET, PUT, PATCH with content)
- **400 Bad Request**: Client errors (validation, malformed requests)
- **404 Not Found**: Resource not found
- **401 Unauthorized**: Authentication required
- **403 Forbidden**: Authenticated but not authorized
- **500 Internal Server Error**: Server errors

## Status Code Utilities

The `server/utils/http/statusCodes.js` module provides semantic status code functions:

- `statusForCreation(success, hasContent, options)` - Returns 201 for successful creation with content, 400 for failures
- `statusForUpdate(success, hasContent)` - Returns 200/204 for updates
- `statusForDeletion(success, notFound)` - Returns 204 for successful deletions
- `statusForRetrieval(success, found)` - Returns 200/404 for retrievals

## User Creation Endpoint

**Endpoint**: `POST /v1/admin/users/new`

**Status Codes**:
- `201 Created`: User successfully created, response body contains `{ user: {...}, error: null }`
- `400 Bad Request`: User creation failed, response body contains `{ user: null, error: "..." }`
- `401 Unauthorized`: Multi-user mode not enabled
- `403 Forbidden`: Invalid service identity token
- `500 Internal Server Error`: Server error

**Example Success Response**:
```json
HTTP/1.1 201 Created
Content-Type: application/json

{
  "user": {
    "id": 123,
    "username": "john.doe",
    "role": "default",
    "externalId": "keystone-user-456",
    "externalProvider": "keystone"
  },
  "error": null
}
```

## Rationale

Using `201 Created` for successful resource creation is the REST standard and clearly signals to clients that:
1. The resource was successfully created
2. The response body contains the created resource
3. The operation is idempotent-safe (can be retried)

While `204 No Content` is technically valid for successful creation without a response body, `201 Created` is preferred when returning the created resource as it provides better semantic clarity and follows HTTP specification (RFC 7231).


