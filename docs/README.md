# Documentation

This directory contains documentation for AnythingLLM service-to-service authentication and related features.

## Service-to-Service Authentication

- **[SERVICE_TO_SERVICE_AUTHENTICATION.md](./SERVICE_TO_SERVICE_AUTHENTICATION.md)** - Complete implementation guide for service-to-service authentication between Keystone Core API and AnythingLLM

- **[KEYSTONE_IMPLEMENTATION_GUIDE.md](./KEYSTONE_IMPLEMENTATION_GUIDE.md)** - Implementation guide for Keystone developers on how to mint and attach service identity tokens

## Overview

The service-to-service authentication system enables secure communication between Keystone Core API (public-facing) and AnythingLLM (internal RAG layer) using:

- **Production**: GCP OIDC ID tokens minted via Application Default Credentials
- **Development**: RS256 JWTs signed with a shared key pair

This ensures that only approved service identities can access AnythingLLM's internal/admin routes, providing a secure, HIPAA-aligned authentication boundary.

