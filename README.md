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
4. **create_ado_ticket** (JavaScript) - Copy from `3_create_ado_ticket.js` (optional)

### Step 3: Configure Each Task

Search each file for `TODO:` comments — these mark every field that needs customization.

### Step 4: Configure Email Task

**Subject:**
```
[EXT] SLO Report - Your Domain Name - {{ result('build_markdown_email').reportDate }}
```

**Message:**
```
{{ result('build_markdown_email').markdown }}
```

### Step 5: Configure Task Conditions

| Task | Predecessor Condition | Custom Condition |
|------|----------------------|------------------|
| **fetch_slo_data** | *(none - first task)* | *(leave blank)* |
| **build_markdown_email** | fetch_slo_data = **success** | *(leave blank)* |
| **send_email** | build_markdown_email = **success** | *(leave blank)* |
| **create_ado_ticket** | fetch_slo_data = **success** | `{{ result('fetch_slo_data').hasBreach == true }}` |

## ⚙️ Configuration Guide

### 1_fetch_slo_data.js

| Setting | Description | Example |
|---------|-------------|---------|
| `sloIds` | Array of SLO IDs to monitor | `["abc-123", "def-456"]` |
| `dashboardUrl` | URL to your SLO dashboard | `https://tenant.apps.dynatrace.com/...` |
| `syntheticSloConfig` | Map of synthetic SLO IDs to monitor config | See file comments |
| `SLO_BATCH_SIZE` | Number of SLOs per API call (default: 20) | `20` |
| `USQL_BATCH_SIZE` | User actions per USQL query (default: 10) | `10` |

### 2_build_markdown_email.js

| Setting | Description | Example |
|---------|-------------|---------|
| `reportTitle` | Main report heading | `"🏦 Northern Trust - SLO Report"` |
| `reportSubtitle` | Domain/environment label | `"Financial Picture (PPC)"` |
| `dynatraceTenantUrl` | Your tenant URL for deep links | `"https://abc123.apps.dynatrace.com"` |
| `prioritySloIds` | SLO IDs to pin at top of each category | `["id-1", "id-2"]` |
| `sloExplainedUrl` | Link to SLO documentation dashboard | URL string |
| `errorAnalysisUrl` | Link to error analysis dashboard (optional) | URL string or `""` |

### 3_create_ado_ticket.js

| Setting | Description | Example |
|---------|-------------|---------|
| `adoOrganization` | Azure DevOps org name | `"your-org"` |
| `adoProject` | ADO project name | `"your-project"` |
| `adoPatCredentialId` | Dynatrace Credential Vault ID for ADO PAT | `"CREDENTIALS_VAULT-xxxxx"` |
| `areaPath` | Work item area path | `"Project\\Team"` |
| `workItemType` | ADO work item type | `"Bug"` or `"Task"` |

## 📊 Report Features

### SLO Categorization

SLOs are categorized into three sections based on their **7-day evaluation window**:

- **❌ SLOs Below Target (Action Required)** — 7-day value is below the SLO target
- **✅ SLOs Meeting Target** — 7-day value meets or exceeds the SLO target
- **➖ SLOs With No Data** — No valid data for the 7-day window

> Using the 7-day window provides more stable alerting than daily values. A single bad day won't trigger an action item, but sustained issues will always surface.

### Trend Analysis (4-Window)

The trend column evaluates all transitions across four time windows (90d → 30d → 7d → current):

| Emoji | Meaning | Logic |
|-------|---------|-------|
| 📈 | Consistently improving | ALL transitions going up |
| 📉 | Consistently degrading | ALL transitions going down |
| ➡️ | Stable | ALL transitions within ±0.005% |
| 〰️ | Fluctuating | Mixed up and down transitions |
| ➖ | Insufficient data | Fewer than 2 valid data points |

### Priority SLO Ordering

Application-level SLOs (e.g., Application Apdex, Error-Free Rate) can be pinned to the top of each category by adding their IDs to the `prioritySloIds` array. These SLOs appear first in their defined order, followed by remaining SLOs alphabetically.

### User Action Metrics

User actions are shown only when they need attention:
- **≥10 total errors** (custom + JS + request errors combined)
- **≥3 second average duration**

Actions are ranked by severity score and limited to the top 3 per SLO to keep reports concise. Each action name links directly to its Dynatrace detail page.

### Synthetic Monitoring

For SLOs backed by synthetic monitors instead of real user actions, a separate section shows:
- 7-day average availability percentage
- Comparison against the SLO target
- Number of monitoring locations
- Direct link to the synthetic monitor in Dynatrace

Synthetic data only displays when availability drops below the configured threshold.

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| "No data" for all SLOs | Verify SLO IDs exist in your environment |
| User action links not clickable | Ensure actions are marked as "Key User Actions" in Dynatrace |
| Empty user action metrics | USQL query may be failing — check workflow execution logs |
| Synthetic section missing | Verify `syntheticSloConfig` is correctly mapped in `1_fetch_slo_data.js` |
| ADO ticket not created | Check that the custom condition `{{ result('fetch_slo_data').hasBreach == true }}` is set |
| Wrong SLOs in "Action Required" | Categorization uses the 7-day value, not the current (1-day) value |

## 📝 Changelog

### v2.0 (February 2025)
- **7-day evaluation window** — SLO categorization (pass/fail) and status emoji now based on the 7-day value instead of the current (1-day) value for more stable alerting
- **4-window trend analysis** — Trend column evaluates all transitions across 90d → 30d → 7d → current with near-zero threshold (0.005%)
- **Fluctuating indicator** — New 〰️ emoji for SLOs with mixed up/down movement across windows
- **Action Required note** — Italicized note beneath the "Action Required" heading clarifying that categorization is based on the 7-day value
- **Priority SLO ordering** — Application-level SLOs can be pinned to the top of each category

### v1.0 (January 2025)
- Initial release with multi-window SLO reporting
- User action metrics with deep links
- Synthetic monitor availability tracking
- Azure DevOps work item integration
