# Dynatrace SLO Email Report Workflow Template

A configurable Dynatrace Workflow template for automated SLO monitoring and email reporting with optional Azure DevOps integration.

## 📋 Overview

This workflow automates SLO health reporting by:
- Fetching SLO status across multiple time periods (90-day, 30-day, 7-day, current)
- Collecting user action performance metrics (duration, errors)
- Generating clickable deep links to Dynatrace pages
- Monitoring synthetic test availability
- Sending formatted email reports
- Optionally creating Azure DevOps work items on SLO breaches

## 🏗️ Workflow Structure

```
┌─────────────────────┐
│      TRIGGER        │
│  (Schedule/Manual)  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  1_fetch_slo_data   │
│    (JavaScript)     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 2_build_markdown    │
│    (JavaScript)     │
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌─────────────────┐
│ 3_send  │ │ 4_create_ado    │
│ _email  │ │ (conditional:   │
│         │ │  hasBreach)     │
└─────────┘ └─────────────────┘
```

## 📁 Files

| File | Description |
|------|-------------|
| `1_fetch_slo_data.js` | Fetches SLO status, user action metrics, and synthetic data |
| `2_build_markdown_email.js` | Transforms data into formatted markdown report |
| `3_create_ado_ticket.js` | Creates Azure DevOps work items (optional) |
| `README.md` | This documentation |

## 🚀 Quick Start

### Step 1: Create the Workflow

1. Navigate to **Dynatrace > Automations > Workflows**
2. Click **Create Workflow**
3. Add a trigger (recommended: Time interval, e.g., daily at 8 AM)

### Step 2: Add Tasks

Add four tasks in sequence:

1. **fetch_slo_data** (JavaScript) - Copy from `1_fetch_slo_data.js`
2. **build_markdown_email** (JavaScript) - Copy from `2_build_markdown_email.js`
3. **send_email** (Send Email action) - Configure recipients
4. **create_ado_ticket** (JavaScript, optional) - Copy from `3_create_ado_ticket.js`

### Step 3: Configure Task Connections

```
fetch_slo_data → build_markdown_email → send_email
                                      ↘ create_ado_ticket (conditional)
```

For `create_ado_ticket`, set the condition:
```
{{ result('fetch_slo_data').hasBreach == true }}
```

### Step 4: Customize Configuration

Edit the `CONFIGURATION` section in each JavaScript task (see below).

## ⚙️ Configuration Guide

### 1_fetch_slo_data.js

#### Adding Regular SLOs

```javascript
const sloIds = [
  "your-slo-id-1",  // Copy from SLO URL or API
  "your-slo-id-2",
  // Add more SLO IDs here
];
```

**Finding SLO IDs:**
- Open the SLO in Dynatrace
- The ID is in the URL: `https://.../#slo;id=<SLO_ID>`

#### Adding Synthetic-Based SLOs

```javascript
const syntheticSloConfig = {
  "slo-id-for-synthetic": {
    syntheticId: "SYNTHETIC_TEST-XXXXXXXXXXXXXXXX",  // From synthetic URL
    syntheticName: "Human-readable name",
    type: "BROWSER"  // or "HTTP"
  }
};
```

**Finding Synthetic IDs:**
- Open the synthetic monitor in Dynatrace
- The ID is in the URL: `https://.../browser-monitor/<SYNTHETIC_ID>`

#### Setting Dashboard URL

```javascript
const dashboardUrl = "https://your-tenant.apps.dynatrace.com/ui/apps/dynatrace.classic.dashboards/#dashboard;id=<DASHBOARD_ID>";
```

### 2_build_markdown_email.js

#### Customizing Thresholds

```javascript
// When to show synthetic monitors (only if below this)
const SYNTHETIC_AVAILABILITY_THRESHOLD = 99.98;
```

#### Customizing Attention Criteria

```javascript
// In needsAttention() function:
return totalErrors >= 10 || avgDuration >= 3000;  // 10 errors or 3 seconds
```

#### Updating Dynatrace Tenant URL

Search and replace all instances of:
```
https://uaa82747.apps.dynatrace.com
```
with your tenant URL.

### 3_create_ado_ticket.js

#### Azure DevOps Configuration

```javascript
const adoOrganization = "YourOrganization";
const adoProject = "YourProject";
const areaPath = "YourProject\\Team\\Area";
const credentialVaultId = "CREDENTIALS_VAULT-XXXXXXXXXXXXXXXX";
```

#### Work Item Type

```javascript
const workItemType = "User Story";  // or "Bug", "Task", "Feature"
```

## 🔑 Prerequisites

### Required Dynatrace Permissions

- **SLO Read** - For fetching SLO status
- **Entities Read** - For user action entity lookups
- **Metrics Read** - For synthetic availability
- **USQL Access** - For user action performance data

### For Azure DevOps Integration

1. **Create a PAT** in Azure DevOps with `Work Items: Read & Write` scope
2. **Store in Credential Vault:**
   - Navigate to **Settings > Credential Vault**
   - Add new credential with the PAT
   - Note the credential ID
3. **Add to Allowed Outbound Connections:**
   - Navigate to **Settings > Allowed Outbound Connections**
   - Add `dev.azure.com`

### For Key User Actions (Clickable Links)

User actions must be marked as **Key User Actions** to have entity IDs and enable deep linking:

1. Navigate to **Frontend > Application > User Actions**
2. Select the user action
3. Click **Mark as key user action**

## 📧 Email Task Configuration

Configure the built-in **Send Email** task:

| Field | Value |
|-------|-------|
| **To** | recipient@company.com |
| **Subject** | `[EXT] SLO Report - {{result('build_markdown_email').reportDate}}` |
| **Body** | `{{result('build_markdown_email').markdown}}` |

## 🎨 Customization Examples

### Example: Adding a New Domain Report

1. Copy all files to a new workflow
2. Update `sloIds` with your domain's SLOs
3. Update report title in `build_markdown_email.js`:
   ```javascript
   markdown += "## Your Domain Name (PPC)\n\n";
   ```
4. Update dashboard URL to your domain's dashboard

### Example: Changing Error Thresholds

In `2_build_markdown_email.js`, modify `needsAttention()`:

```javascript
const needsAttention = (metrics) => {
  if (!metrics) return false;
  const totalErrors = (metrics.customErrors || 0) + (metrics.jsErrors || 0) + (metrics.requestErrors || 0);
  const avgDuration = metrics.avgDuration || 0;
  
  // Customize these thresholds:
  return totalErrors >= 5 || avgDuration >= 2000;  // More sensitive
};
```

### Example: Removing ADO Integration

Simply don't add the `create_ado_ticket` task to your workflow.

## 🔍 Troubleshooting

### No User Action Links

- Ensure user actions are marked as **Key User Actions**
- Only Key User Actions receive APPLICATION_METHOD entity IDs

### USQL Errors (414 URI Too Long)

- Reduce `USQL_BATCH_SIZE` in `1_fetch_slo_data.js`
- Default is 10; try 5 for very long action names

### ADO Ticket Creation Fails

- Verify PAT has correct scopes
- Check area path permissions
- Ensure `dev.azure.com` is in allowed outbound connections

### Missing Synthetic Data

- Verify synthetic monitor ID is correct
- Check that the synthetic monitor has recent executions
- Ensure `type` matches ("BROWSER" vs "HTTP")

## 📊 Report Output Example

```
# 🏦 Northern Trust - SLO Report

## Your Domain (PPC)

**Report Date:** 2026-01-30

## Executive Summary

| Metric | Value |
|--------|-------|
| **Overall Status** | ✅ OK |
| Total SLOs Monitored | 4 |
| Passing | 3 ✅ |
| Failing | 1 ❌ |

## ❌ SLOs Below Target (Action Required)

| SLO Name | Target | 90 Day | 30 Day | 7 Day | Current | Trend |
|----------|--------|--------|--------|-------|---------|-------|
| ❌ Checkout Flow | 99% | 99.50% | 99.20% | 98.80% | 98.50% | 📉 |
```

## 📝 License

Internal use only. Customize as needed for your organization.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request with clear documentation

---

**Questions?** Contact the Observability Team or open an issue.

