# Infrastructure Redirects

EverClaw uses Cloudflare Redirect Rules for vanity URLs that point to GitHub raw content.

---

## Active Redirects

### get.everclaw.xyz

**Purpose:** One-liner install endpoint for `curl -fsSL https://get.everclaw.xyz | bash`

| Property | Value |
|----------|-------|
| **Type** | 302 Redirect Rule (Cloudflare) |
| **Target** | `https://raw.githubusercontent.com/profbernardoj/morpheus-skill/main/packages/core/scripts/install-with-deps.sh` |
| **Domain** | everclaw.xyz |
| **Path** | `/` (root) |
| **Status Code** | 302 Found |
| **Last Updated** | 2026-05-18 (monorepo restructure fix) |

**Why 302 instead of 301:**
- 302 (Found) is temporary — browsers and CDNs don't cache it as aggressively
- Allows future changes to the target URL without cache purging or long TTL waits
- 301 (Moved Permanently) would require cache invalidation if target URL changes

**Verification:**
```bash
# Should return 302 redirect
curl -I https://get.everclaw.xyz

# Should return 200 and valid bash script
curl -fsSL https://get.everclaw.xyz | head -20
```

---

## Retired Redirects

_(None currently)_

---

## Monitoring Recommendations

### Synthetic Check (Optional)

Create a synthetic monitoring check (UptimeRobot, Better Uptime, or Cloudflare Synthetic) that:

1. **Request:** `curl -I https://get.everclaw.xyz`
2. **Expected:**
   - Status code: 302 (redirect)
   - Location header contains: `raw.githubusercontent.com`
3. **Alert if:**
   - Status code is not 302
   - Location header is missing or doesn't contain expected domain
   - Response time > 3000ms

### Manual Verification

Run periodically to ensure redirect chain is healthy:

```bash
# Full redirect chain (should end at 200)
curl -L -I https://get.everclaw.xyz | grep -E "^HTTP|^location"

# Verify final content is valid bash
curl -fsSL https://get.everclaw.xyz | head -5
```

---

## Change History

| Date | Change | Reason |
|------|--------|--------|
| 2026-05-18 | Updated target URL to monorepo path | v2026.4.22 monorepo restructure moved scripts to `packages/core/scripts/` |
| 2026-04-22 | Original redirect created | Initial one-liner install setup |

---

## Cloudflare Dashboard Steps

To update a redirect rule:

1. Login to Cloudflare Dashboard
2. Select domain: `everclaw.xyz`
3. Navigate to: **Rules** → **Redirect Rules**
4. Find the rule for `get.everclaw.xyz`
5. Update **Target URL** field
6. Set **Status Code** to `302 Found`
7. Click **Save and Deploy**

Changes propagate globally within seconds (Cloudflare's edge network).

---

## Related Documentation

- [Coding Pipeline](./coding-pipeline.md) — SOP-001 deployment process
- [Troubleshooting](./troubleshooting.md) — Common issues and fixes
- [Installation Guide](../getting-started/installation.md) — Install methods