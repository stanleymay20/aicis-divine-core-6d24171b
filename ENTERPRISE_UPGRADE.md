# 🏢 Enterprise Security Controls Upgrade

## Evidence boundary

This document records security, privacy and operational controls implemented or intended by the AICIS codebase. It does **not** by itself establish production readiness, legal compliance, independent certification, availability guarantees or successful deployment in a specific target environment.

Terms such as GDPR, SOC 2, HIPAA and ISO 27001 below identify control areas that may be relevant to a future compliance program. Certification / compliance status must be established separately through deployment-specific technical, legal and independent assurance evidence.

## ✅ What Was Upgraded

AICIS includes a set of **enterprise-oriented security and operational controls** that can contribute to a production hardening and compliance program when they are verified in the target deployment context.

### 🔐 Security Enhancements

1. **Comprehensive Audit Logging**
   - Sensitive actions can be logged with user, IP, timestamp
   - Severity levels: info, warning, error, critical
   - Searchable by user, organization, action type
   - Relevant to audit-control requirements; not proof of SOC 2, GDPR, HIPAA or other compliance by itself

2. **Rate Limiting & DDoS Protection**
   - Automatic rate limiting per user/IP
   - Configurable limits per endpoint
   - Auto-blocking of abusive traffic
   - Admin unblock capability

3. **Enhanced Session Management**
   - Track active sessions per user
   - IP address and device tracking
   - Remote session revocation
   - Session expiry enforcement

4. **IP Access Control**
   - Organization-level IP whitelist/blacklist
   - CIDR range support
   - Temporary or permanent blocks
   - Security event logging

5. **Function Security Hardening**
   - Search-path hardening for privileged functions
   - `SECURITY DEFINER` functions should use explicit schema / search-path controls
   - Intended to reduce search-path manipulation risk

### 🛡️ GDPR & Privacy Control Areas

1. **Data Portability Workflow**
   - Users can request a data export
   - Secure download-link pattern with expiration
   - Audit trail of export requests

2. **Account / Data Deletion Workflow**
   - Account deletion request workflow
   - Admin approval process
   - Data-purge pathway
   - Deletion audit logging

3. **Consent Management**
   - Existing `user_consent` table
   - Integrated with privacy flows

These controls may support obligations such as GDPR Articles 17 and 20, but legal applicability, completeness, retention rules, controller/processor responsibilities, lawful basis and deployment-specific behavior still require explicit review.

### 📊 Operational Excellence

1. **System Health Monitoring**
   - Health checks for database, storage and edge-function surfaces
   - Response-time tracking
   - Component-status dashboard
   - Degradation-alert concepts

2. **Per-Tenant Metrics**
   - API request counting
   - Storage usage tracking
   - Error-rate monitoring
   - Cost estimation per organization
   - Performance analytics

3. **Automated Maintenance**
   - Cleanup of old rate-limit records
   - Expired-export removal
   - Critical-event alerting concepts
   - Health-check cron job

## 🔧 Database Tables

| Table | Purpose |
|-------|---------|
| `audit_log` | Audit trail for security / compliance workflows |
| `rate_limits` | Rate limiting and abuse protection |
| `user_sessions` | Session tracking |
| `ip_access_control` | IP whitelist/blacklist |
| `data_export_requests` | Data-export request tracking |
| `data_deletion_requests` | Account / data-deletion request tracking |
| `system_health` | System-monitoring records |
| `tenant_metrics` | Per-organization usage metrics |

## 🎯 Edge Functions

| Function | Purpose |
|----------|---------|
| `enterprise-health-check` | System health monitoring |
| `gdpr-export-data` | User data export workflow |
| `gdpr-delete-data` | Account / data deletion workflow |
| `cron-enterprise-health` | Automated health / cleanup workflow |

## 🎨 UI Components

| Component | Access | Purpose |
|-----------|--------|---------|
| `EnterpriseSecurityPanel` | All Users | View health, audit logs, sessions and privacy workflows |
| `AdminSecurityDashboard` | Admins Only | Manage rate limits, IP controls and security events |

## 🚀 How to Use

### For End Users

1. **View Your Activity**
   ```tsx
   import { EnterpriseSecurityPanel } from "@/components/EnterpriseSecurityPanel";
   
   // Add to user dashboard
   <EnterpriseSecurityPanel />
   ```

2. **Request Data Export**
   - Navigate to GDPR & Privacy tab
   - Click "Request Data Export"
   - Download when ready

3. **Manage Sessions**
   - View active login sessions
   - Revoke suspicious sessions remotely

### For Administrators

1. **Security Dashboard**
   ```tsx
   import { AdminSecurityDashboard } from "@/components/AdminSecurityDashboard";
   
   // Add to admin panel (role-gated)
   {hasRole(user, 'admin') && <AdminSecurityDashboard />}
   ```

2. **Monitor Health**
   - System health status
   - Component response times
   - Degradation alerts where configured

3. **Manage IP Access**
   - Add IPs to blacklist
   - Add IPs to whitelist
   - View access-control rules

4. **Review Security Events**
   - View suspected breach attempts
   - Policy violations
   - Critical incidents

### Programmatic Usage

#### Log Audit Events
```typescript
await supabase.rpc("log_audit_event", {
  _user_id: user.id,
  _org_id: org.id,
  _action: "data.delete",
  _resource_type: "customer_record",
  _resource_id: recordId,
  _ip_address: "192.168.1.1",
  _severity: "warning",
  _metadata: { reason: "GDPR request" }
});
```

#### Check Rate Limit
```typescript
const allowed = await supabase.rpc("check_rate_limit", {
  _user_id: user.id,
  _ip: ipAddress,
  _endpoint: "/api/sensitive-operation",
  _limit: 10,
  _window_minutes: 60
});

if (!allowed) {
  throw new Error("Rate limit exceeded");
}
```

#### Check IP Access
```typescript
const allowed = await supabase.rpc("check_ip_access", {
  _org_id: org.id,
  _ip_address: requestIp
});

if (!allowed) {
  throw new Error("IP not allowed");
}
```

## ⚙️ Configuration

### Cron Schedule (in `supabase/config.toml`)

```toml
[functions.cron-enterprise-health]
schedule = "0 * * * *"  # Every hour
```

### Auth Settings

Repository / environment documentation has historically referenced settings such as:

- leaked-password protection;
- development email auto-confirm;
- anonymous-user restrictions.

Treat actual runtime configuration as **environment-specific** and verify it directly before relying on these controls in a readiness or compliance claim.

### Rate Limit Defaults

- Default design value: **100 requests per 60 minutes**
- Configurable per endpoint
- Auto-block duration: matches window size

Verify deployed configuration and enforcement behavior in the target environment before treating these values as operational facts.

## 🔒 Security Best Practices

1. **Always log sensitive operations**
   ```typescript
   // Before performing critical action
   await supabase.rpc("log_audit_event", { ... });
   ```

2. **Implement rate limiting on public endpoints**
   ```typescript
   // In edge functions
   const allowed = await supabase.rpc("check_rate_limit", { ... });
   if (!allowed) return Response.json({ error: "Too many requests" }, { status: 429 });
   ```

3. **Enable IP restrictions for high-security organizations where appropriate**
   - Use whitelist mode only under an explicit access-policy design
   - Validate office / VPN / emergency-access requirements

4. **Monitor audit logs regularly**
   - Review critical/error severity events
   - Investigate unusual patterns
   - Export logs to an external SIEM where required

5. **Rotate sessions appropriately**
   - Force logout after relevant account-security events
   - Revoke old sessions on security incidents

## 📈 Monitoring & Alerting

### Candidate Metrics to Watch

1. **System Health**
   - Database response time
   - Storage availability
   - Edge-function success rate

2. **Security Events**
   - Critical-severity events
   - Failed-login attempts
   - Rate-limit hits

3. **Per-Tenant Usage**
   - API request trends
   - Storage growth rate
   - Cost projections

### Candidate Alert Thresholds

The following values are examples / historical design targets, not verified service-level objectives:

| Metric | Warning | Critical |
|--------|---------|
| DB Response Time | >200ms | >500ms |
| Error Rate | >1% | >5% |
| Critical Events | >0 | >10/hour |
| Rate Limit Blocks | - | >100/hour |

Operational thresholds must be calibrated against a real deployment and documented SLO / incident-response process.

## 🎓 Compliance Relevance — Not Certification

These controls may contribute evidence toward future programs involving:

- **GDPR** privacy and data-subject workflows;
- **SOC 2** security / availability / confidentiality controls;
- **HIPAA** requirements only if AICIS is actually deployed in a covered use case with all applicable safeguards and agreements;
- **ISO 27001** information-security management controls.

No certification or universal compliance claim is made by this document. Certification and legal compliance require a broader management system, deployment evidence, policies, risk assessment, operational practice and, where applicable, independent audit / legal review.

## 🔄 Next Steps

1. **Verify Runtime Controls**
   - prove actual deployed configuration rather than relying on documentation;
   - test authorization, rate limiting, audit and privacy workflows end-to-end;
   - preserve evidence of exact environment / commit tested.

2. **Enable External Monitoring Where Needed**
   - set up incident alerting;
   - configure log forwarding to SIEM where required;
   - validate monitoring coverage and alert ownership.

3. **Customize Rate Limits**
   - adjust limits per endpoint and risk level;
   - create tiered limits by plan where justified;
   - test burst and abuse behavior.

4. **Enhance IP Control**
   - integrate threat intelligence only when governed and necessary;
   - define emergency / administrator access paths;
   - test lockout and recovery scenarios.

5. **Complete Privacy / Compliance Diligence**
   - verify export and deletion completeness;
   - define retention and deletion policies;
   - document data roles, lawful basis and third-party processors where applicable;
   - obtain legal / independent assurance when making formal compliance claims.

6. **Performance Optimization**
   - add caching / CDN / query optimization only from measured bottlenecks;
   - avoid introducing unverified infrastructure complexity.

## 📚 References

- [Supabase Security Best Practices](https://supabase.com/docs/guides/auth/security-best-practices)
- [GDPR Compliance Checklist](https://gdpr.eu/checklist/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [SOC 2 Requirements](https://www.aicpa.org/soc2)

---

**Controlled status:** enterprise-oriented security controls exist in the codebase, but AICIS is **not declared enterprise-ready, certified, or universally compliant by this document**. Production readiness and compliance must be proven for the exact deployment context.
