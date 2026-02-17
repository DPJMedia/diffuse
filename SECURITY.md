# Security Implementation Guide

This document outlines the comprehensive security measures implemented in the Diffuse.AI application following OWASP best practices.

## Security Features Implemented

### 1. Rate Limiting
- **IP-based rate limiting** for anonymous users
- **User-based rate limiting** for authenticated users
- **Tiered limits** for different operation types:
  - Public endpoints: 100 requests per 15 minutes per IP
  - Authenticated endpoints: 200 requests per 15 minutes per user
  - Expensive operations (transcription, workflow): 10 requests per hour per user
  - File uploads: 20 uploads per 15 minutes per user
- **Graceful degradation** with 429 status and Retry-After headers
- Rate limit headers included in all responses

### 2. Input Validation & Sanitization
- **Schema-based validation** - only accepts expected fields, rejects unexpected ones
- **Type checking** - strict type validation for all inputs
- **Length limits** - maximum lengths enforced for all string fields
- **Format validation** - UUID format, URL format, file name validation
- **Path traversal protection** - prevents `../` and absolute paths in file names
- **Control character removal** - sanitizes dangerous characters
- **File size limits**:
  - PDF/DOCX: 50MB
  - TXT: 10MB
  - Audio: 500MB
  - Images: 10MB

### 3. Authentication & Authorization
- **Authentication required** on all API endpoints (except public pages)
- **Ownership verification**:
  - Project ownership checks before accessing/modifying projects
  - Recording ownership checks before accessing/modifying recordings
  - Workspace membership checks for shared resources
- **Role-based access control** - admin checks for workspace operations
- **Proper error handling** - 401 for unauthorized, 403 for forbidden

### 4. API Key Security
- **No hardcoded keys** - all API keys stored in environment variables
- **Server-side only** - API keys never exposed to client
- **Required validation** - application fails to start if required keys are missing
- **Key rotation ready** - easy to rotate keys via environment variables

### 5. Error Handling
- **Safe error messages** - internal errors don't expose system details
- **Consistent error format** - standardized error responses
- **Proper HTTP status codes** - 400, 401, 403, 429, 500 used appropriately

## Environment Variables Required

### Required for Production
```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# API Keys (Server-side only)
ASSEMBLYAI_API_KEY=your_assemblyai_key
N8N_WEBHOOK_URL=your_n8n_webhook_url

# Optional: AI-generated recording titles (Open Router, Claude 3.5 Haiku)
# If omitted, titles are derived from the first sentence of the transcription.
OPENROUTER=your_openrouter_api_key

# Site Configuration
NEXT_PUBLIC_SITE_URL=https://your-domain.com
NODE_ENV=production
```

### Security Notes
- **Never commit** `.env.local` or `.env` files to git
- **Rotate keys** immediately if they are exposed
- **Use different keys** for development and production
- **Restrict access** to environment variables in your hosting platform

## Database Security

### Row Level Security (RLS)
The application relies on Supabase RLS policies for database security. Ensure these policies are properly configured:

1. **Projects**: Users can only access their own projects or public projects in their workspaces
2. **Recordings**: Users can only access their own recordings
3. **Workspaces**: Users can only access workspaces they are members of
4. **Inputs/Outputs**: Access controlled by project ownership

### Database Checklist
- [ ] RLS policies are enabled on all tables
- [ ] Policies check `auth.uid()` for user identification
- [ ] Policies verify workspace membership for shared resources
- [ ] Policies prevent unauthorized updates/deletes

## Vercel Configuration

### Environment Variables
Add all required environment variables in Vercel dashboard:
1. Go to Project Settings → Environment Variables
2. Add each variable for Production, Preview, and Development
3. Ensure `NODE_ENV=production` for production deployments

### Rate Limiting
For production, consider using Vercel's built-in rate limiting or a Redis-based solution for distributed rate limiting across multiple instances.

## Security Checklist

### Before Deployment
- [ ] All environment variables are set in Vercel
- [ ] No hardcoded API keys in code
- [ ] All API endpoints require authentication
- [ ] All endpoints have rate limiting
- [ ] All inputs are validated and sanitized
- [ ] Ownership checks are in place
- [ ] Error messages don't expose internal details
- [ ] Database RLS policies are configured
- [ ] HTTPS is enforced (automatic on Vercel)

### Ongoing Security
- [ ] Monitor rate limit violations
- [ ] Review access logs regularly
- [ ] Rotate API keys periodically
- [ ] Keep dependencies updated
- [ ] Monitor for security advisories
- [ ] Review and update RLS policies as needed

## Security Best Practices

### For Developers
1. **Never trust client input** - always validate and sanitize
2. **Always check ownership** - verify user has access before operations
3. **Use environment variables** - never hardcode secrets
4. **Follow principle of least privilege** - users should only access what they need
5. **Log security events** - but don't log sensitive data
6. **Keep dependencies updated** - regularly update npm packages

### For Operations
1. **Rotate keys regularly** - especially if exposed
2. **Monitor rate limits** - watch for abuse patterns
3. **Review access logs** - identify suspicious activity
4. **Use strong passwords** - for all accounts
5. **Enable 2FA** - for all admin accounts
6. **Backup regularly** - but secure backups properly

## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly:
1. Do not create a public issue
2. Contact the development team directly
3. Provide detailed information about the vulnerability
4. Allow time for the fix before public disclosure

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP API Security](https://owasp.org/www-project-api-security/)
- [Supabase Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Next.js Security](https://nextjs.org/docs/app/building-your-application/configuring/security-headers)
