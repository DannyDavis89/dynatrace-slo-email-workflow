/**
 * ============================================================================
 * TASK 2: BUILD MARKDOWN EMAIL
 * ============================================================================
 * 
 * PURPOSE:
 * Transforms raw SLO data into a formatted markdown email report.
 * 
 * INPUT:
 * Receives data from fetch_slo_data task via execution context
 * 
 * OUTPUT:
 * Returns markdown string and report date for the email task
 * 
 * FEATURES:
 *   - Categorizes SLOs (Passing, Failing, No Data)
 *   - Shows trends across time periods
 *   - Filters user actions to only show those needing attention
 *   - Creates clickable deep links to Dynatrace pages
 *   - Formats synthetic monitor availability
 * 
 * ============================================================================
 */

import { execution } from '@dynatrace-sdk/automation-utils';

export default async function ({ execution_id }) {
  // Retrieve data from the fetch_slo_data task
  const ex = await execution(execution_id);
  const sloData = await ex.result('fetch_slo_data');

  console.log("=== BUILD MARKDOWN EMAIL ===");
  console.log("Number of SLOs received: " + sloData.slos.length);
  console.log("User action metrics received: " + Object.keys(sloData.userActionMetrics || {}).length);
  console.log("User action entities received: " + Object.keys(sloData.userActionEntities || {}).length);
  console.log("Synthetic metrics received: " + Object.keys(sloData.syntheticMetrics || {}).length);

  // ============================================================================
  // CONFIGURATION - MODIFY THIS SECTION FOR YOUR USE CASE
  // ============================================================================

  /**
   * Report Title and Branding
   * Customize these for your organization and domain
   */
  const REPORT_TITLE = "🏦 Your Organization - SLO Report";  // TODO: Update organization name
  const REPORT_SUBTITLE = "Your Domain Name (PPC)";          // TODO: Update domain name

  /**
   * Dashboard URLs
   * Links included in the email for easy access to Dynatrace
   */
  const sloExplainedUrl = "https://YOUR-TENANT.apps.dynatrace.com/ui/apps/dynatrace.classic.dashboards/#dashboard;gtf=-1w;gf=all;id=YOUR-DASHBOARD-ID";
  // TODO: Replace with your "SLOs Explained" dashboard URL (or remove if not needed)

  /**
   * Dynatrace Tenant Base URL
   * Used for building deep links to user actions and synthetic monitors
   */
  const DYNATRACE_BASE_URL = "https://YOUR-TENANT.apps.dynatrace.com";
  // TODO: Replace with your Dynatrace tenant URL

  /**
   * Thresholds for Filtering
   * Only items exceeding these thresholds will be shown in the report
   */
  const SYNTHETIC_AVAILABILITY_THRESHOLD = 99.98;  // Show synthetic if below this %
  const ERROR_THRESHOLD = 10;                       // Show user action if errors >= this
  const DURATION_THRESHOLD_MS = 3000;               // Show user action if duration >= this (milliseconds)

  /**
   * Duration Warning Thresholds (for emoji indicators)
   */
  const DURATION_WARNING_MS = 3000;   // ⚠️ Warning threshold
  const DURATION_CRITICAL_MS = 12000; // ❌ Critical threshold

  /**
   * Error Warning Thresholds (for emoji indicators)
   */
  const ERROR_WARNING = 10;   // ⚠️ Warning threshold
  const ERROR_CRITICAL = 10;  // ❌ Critical threshold (same as warning = any errors are critical)

  /**
   * Maximum user actions to show per SLO
   */
  const MAX_USER_ACTIONS_PER_SLO = 3;

  // ============================================================================
  // HELPER FUNCTIONS - MODIFY IF YOU NEED DIFFERENT FORMATTING
  // ============================================================================

  /** Safely get nested property */
  const safeGet = (obj, prop) => obj && obj[prop] !== undefined ? obj[prop] : null;

  /** Check if status value is valid */
  const isValidStatus = (val) => val != null && val !== undefined && val >= 0;

  /** Format percentage status */
  const fmtStatus = (val) => {
    if (!isValidStatus(val)) return "N/A";
    return val.toFixed(2) + "%";
  };

  /** Get status emoji based on value vs target */
  const getStatusEmoji = (val, target) => {
    if (!isValidStatus(val)) return "➖";
    if (val >= target) return "✅";
    if (val >= target * 0.95) return "⚠️";  // Within 5% of target
    return "❌";
  };

  /** Get trend indicator comparing current to 7-day */
  const getTrend = (day7Val, currentVal) => {
    if (!isValidStatus(day7Val) || !isValidStatus(currentVal)) return "";
    const diff = currentVal - day7Val;
    if (diff > 1) return "📈";   // Improving by more than 1%
    if (diff < -1) return "📉";  // Degrading by more than 1%
    return "➡️";                 // Stable
  };

  /** Get the "current" period data with fallback */
  const getCurrent = (slo) => {
    if (slo.current) return slo.current;
    if (slo.daily) return slo.daily;
    return { status: null, errorBudget: null };
  };

  /** Format duration with emoji warning */
  const fmtDurationWithEmoji = (ms) => {
    if (ms == null || ms === undefined) return "N/A";

    let formatted;
    if (ms < 1000) {
      formatted = Math.round(ms) + " ms";
    } else {
      formatted = (ms / 1000).toFixed(2) + " s";
    }

    if (ms > DURATION_CRITICAL_MS) {
      return formatted + " ❌";
    } else if (ms > DURATION_WARNING_MS) {
      return formatted + " ⚠️";
    }

    return formatted;
  };

  /** Get error emoji based on count */
  const getErrorEmoji = (count) => {
    if (count == null || count === 0) return "";
    if (count <= ERROR_WARNING) return " ⚠️";
    return " ❌";
  };

  /**
   * Shorten user action name for display
   * Extracts action type and endpoint, truncates long paths
   */
  const shortenUserAction = (userAction) => {
    if (!userAction) return "N/A";

    let actionType = "";
    let endpoint = "";

    if (userAction.includes(" landing on ")) {
      const parts = userAction.split(" landing on ");
      actionType = parts[0];
      endpoint = parts[1] || "";
    } else if (userAction.includes(" of page ")) {
      const parts = userAction.split(" of page ");
      actionType = parts[0];
      endpoint = parts[1] || "";
    } else {
      return userAction.length > 50 ? userAction.substring(0, 47) + "..." : userAction;
    }

    // Extract just the path, remove domain
    let path = endpoint.replace(/https?:\/\/[^\/]+/, "");
    const segments = path.split("/").filter(s => s.length > 0);
    if (segments.length > 2) {
      endpoint = ".../" + segments.slice(-2).join("/");
    } else if (segments.length > 0) {
      endpoint = ".../" + segments.join("/");
    } else {
      endpoint = path;
    }

    return actionType + " → " + endpoint;
  };

  /**
   * Build Dynatrace user action deep link URL
   * 
   * NOTE: Only works for Key User Actions (those with entity IDs)
   */
  const buildUserActionUrl = (userAction, entities) => {
    if (!entities || !entities.entityId || !entities.applicationId) {
      return null;
    }

    const encodedName = userAction
      .replace(/ /g, '%20')
      .replace(/:/g, ':')
      .replace(/\/\//g, '%5C0%5C0')
      .replace(/\//g, '%5C0');

    const baseUrl = DYNATRACE_BASE_URL + "/ui/apps/dynatrace.classic.frontend/#uemapplications/uemuseractionmetrics";

    return baseUrl +
      ";uemuserActionId=" + entities.entityId +
      ";uaname=" + encodedName +
      ";uemapplicationId=" + entities.applicationId +
      ";gtf=-7d;gf=all";
  };

  /**
   * Build Dynatrace synthetic monitor deep link URL
   */
  const buildSyntheticUrl = (syntheticId, type) => {
    if (!syntheticId) return null;

    const baseUrl = DYNATRACE_BASE_URL + "/ui/apps/dynatrace.classic.synthetic/ui";

    // Determine monitor type path
    let monitorPath;
    if (type === "BROWSER") {
      monitorPath = "browser-monitor";
    } else if (type === "HTTP") {
      monitorPath = "http-monitor";
    } else {
      monitorPath = "browser-monitor"; // default
    }

    return baseUrl + "/" + monitorPath + "/" + syntheticId + "?gtf=-7d&gf=all";
  };

  /**
   * Check if a user action needs attention based on thresholds
   * Modify the conditions here to change what's shown in the report
   */
  const needsAttention = (metrics) => {
    if (!metrics) return false;

    const totalErrors = (metrics.customErrors || 0) + (metrics.jsErrors || 0) + (metrics.requestErrors || 0);
    const avgDuration = metrics.avgDuration || 0;

    // ┌─────────────────────────────────────────────────────────────────────────
    // │ MODIFY THESE CONDITIONS TO CHANGE FILTERING LOGIC
    // └─────────────────────────────────────────────────────────────────────────
    return totalErrors >= ERROR_THRESHOLD || avgDuration >= DURATION_THRESHOLD_MS;
  };

  /**
   * Calculate attention score for ranking user actions by severity
   * Higher score = more severe = shown first
   */
  const getAttentionScore = (metrics) => {
    if (!metrics) return 0;

    const totalErrors = (metrics.customErrors || 0) + (metrics.jsErrors || 0) + (metrics.requestErrors || 0);
    const avgDurationSeconds = (metrics.avgDuration || 0) / 1000;

    // ┌─────────────────────────────────────────────────────────────────────────
    // │ MODIFY THIS FORMULA TO CHANGE HOW ISSUES ARE PRIORITIZED
    // │ Current: Errors weighted 10x, duration in seconds added
    // └─────────────────────────────────────────────────────────────────────────
    return (totalErrors * 10) + avgDurationSeconds;
  };

  /** Format synthetic availability with emoji */
  const fmtSyntheticAvailability = (availability, target) => {
    if (availability == null) return "N/A";

    const formatted = availability.toFixed(2) + "%";

    if (availability >= target) {
      return "✅ " + formatted;
    } else if (availability >= target * 0.99) {
      return "⚠️ " + formatted;
    } else {
      return "❌ " + formatted;
    }
  };

  // ============================================================================
  // CATEGORIZE SLOs
  // ============================================================================
  const failingSLOs = sloData.slos.filter(slo => {
    const current = getCurrent(slo);
    const status = safeGet(current, "status");
    return isValidStatus(status) && status < slo.target;
  });

  const passingSLOs = sloData.slos.filter(slo => {
    const current = getCurrent(slo);
    const status = safeGet(current, "status");
    return isValidStatus(status) && status >= slo.target;
  });

  const noDataSLOs = sloData.slos.filter(slo => {
    const current = getCurrent(slo);
    const status = safeGet(current, "status");
    return !isValidStatus(status);
  });

  console.log("Categorized: " + failingSLOs.length + " failing, " + passingSLOs.length + " passing, " + noDataSLOs.length + " no data");

  const breachStatus = failingSLOs.length > 0 ? "❌ BREACH" : "✅ OK";

  // ============================================================================
  // BUILD MARKDOWN REPORT
  // ============================================================================
  let markdown = "";

  // ──────────────────────────────────────────────────────────────────────────
  // HEADER SECTION
  // ──────────────────────────────────────────────────────────────────────────
  markdown += "# " + REPORT_TITLE + "\n\n";
  markdown += "## " + REPORT_SUBTITLE + "\n\n";
  markdown += "**Report Date:** " + sloData.reportDate + "\n\n";

  markdown += "View SLO details and contributing factors on [dashboard](" + sloData.dashboardUrl + ")\n\n";
  
  // Optional: Add SLOs explained link (remove if not needed)
  if (sloExplainedUrl && sloExplainedUrl.includes("YOUR-TENANT") === false) {
    markdown += "[SLOs explained](" + sloExplainedUrl + ")\n";
  }

  // ──────────────────────────────────────────────────────────────────────────
  // EXECUTIVE SUMMARY
  // ──────────────────────────────────────────────────────────────────────────
  markdown += "---\n\n";
  markdown += "## Executive Summary\n\n";
  markdown += "| Metric | Value |\n";
  markdown += "|--------|-------|\n";
  markdown += "| **Overall Status** | " + breachStatus + " |\n";
  markdown += "| Total SLOs Monitored | " + sloData.slos.length + " |\n";
  markdown += "| Passing | " + passingSLOs.length + " ✅ |\n";
  markdown += "| Failing | " + failingSLOs.length + (failingSLOs.length > 0 ? " ❌" : "") + " |\n";
  markdown += "| No Data | " + noDataSLOs.length + (noDataSLOs.length > 0 ? " ➖" : "") + " |\n";
  markdown += "\n";

  // ──────────────────────────────────────────────────────────────────────────
  // SLO TABLE BUILDER
  // ──────────────────────────────────────────────────────────────────────────
  const buildSLOTable = (slos, title) => {
    if (slos.length === 0) return "";

    let table = "---\n\n";
    table += "## " + title + "\n\n";
    table += "| SLO Name | Target | 90 Day | 30 Day | 7 Day | Current | Trend |\n";
    table += "|----------|--------|--------|--------|-------|---------|-------|\n";

    for (const slo of slos) {
      const current = getCurrent(slo);
      const currentStatus = safeGet(current, "status");
      const day7Status = safeGet(slo.day7, "status");

      const emoji = getStatusEmoji(currentStatus, slo.target);
      const trend = getTrend(day7Status, currentStatus);

      table += "| " + emoji + " " + slo.name + " | " + slo.target + "% | " + 
               fmtStatus(safeGet(slo.day90, "status")) + " | " + 
               fmtStatus(safeGet(slo.day30, "status")) + " | " + 
               fmtStatus(day7Status) + " | " + 
               fmtStatus(currentStatus) + " | " + trend + " |\n";
    }

    return table + "\n";
  };

  // Add SLO tables in order of priority
  if (failingSLOs.length > 0) {
    markdown += buildSLOTable(failingSLOs, "❌ SLOs Below Target (Action Required)");
  }

  if (passingSLOs.length > 0) {
    markdown += buildSLOTable(passingSLOs, "✅ SLOs Meeting Target");
  }

  if (noDataSLOs.length > 0) {
    markdown += buildSLOTable(noDataSLOs, "➖ SLOs With No Data");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // USER ACTION METRICS SECTION
  // Shows only user actions that need attention
  // ──────────────────────────────────────────────────────────────────────────
  const userActionMetrics = sloData.userActionMetrics || {};
  const userActionEntities = sloData.userActionEntities || {};

  const slosWithActionableUserActions = sloData.slos.filter(slo => {
    if (slo.isSynthetic) return false;
    if (!slo.userAction || slo.userAction.length === 0) return false;

    return slo.userAction.some(ua => {
      const metrics = userActionMetrics[ua];
      return metrics && needsAttention(metrics);
    });
  });

  if (slosWithActionableUserActions.length > 0) {
    markdown += "---\n\n";
    markdown += "## 📊 User Action Metrics (7-Day Totals)\n\n";
    markdown += "The following user actions need attention (≥" + ERROR_THRESHOLD + " total errors OR ≥" + (DURATION_THRESHOLD_MS / 1000) + "s avg duration).\n\n";
    markdown += "**Note:** Click on the user action names to view them in Dynatrace. Metrics below are based on completed user sessions and combine all action types (XHR, Load, or Route Change) with the same name, which may result in different averages than the Dynatrace UI where these are displayed separately.\n\n";

    for (const slo of slosWithActionableUserActions) {
      const userActions = Array.isArray(slo.userAction) ? slo.userAction : [slo.userAction];

      const actionsNeedingAttention = userActions.filter(ua => {
        const metrics = userActionMetrics[ua];
        return metrics && needsAttention(metrics);
      });

      if (actionsNeedingAttention.length === 0) continue;

      // Sort by severity and take top N
      const sortedActions = actionsNeedingAttention
        .map(ua => ({ userAction: ua, metrics: userActionMetrics[ua], score: getAttentionScore(userActionMetrics[ua]) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_USER_ACTIONS_PER_SLO);

      markdown += "### " + slo.name + "\n\n";

      markdown += "| User Action | Avg Duration | Custom Errors | JS Errors | Request Errors |\n";
      markdown += "|-------------|--------------|---------------|-----------|----------------|\n";

      for (const item of sortedActions) {
        const metrics = item.metrics;

        const displayAction = shortenUserAction(item.userAction);
        const entityData = userActionEntities[item.userAction];
        const actionUrl = buildUserActionUrl(item.userAction, entityData);
        const linkedAction = actionUrl ? "[" + displayAction + "](" + actionUrl + ")" : displayAction;

        const durationDisplay = fmtDurationWithEmoji(metrics.avgDuration);
        const custDisplay = (metrics.customErrors || 0) + getErrorEmoji(metrics.customErrors);
        const jsDisplay = (metrics.jsErrors || 0) + getErrorEmoji(metrics.jsErrors);
        const reqDisplay = (metrics.requestErrors || 0) + getErrorEmoji(metrics.requestErrors);

        markdown += "| " + linkedAction + " | " + durationDisplay + " | " + custDisplay + " | " + jsDisplay + " | " + reqDisplay + " |\n";
      }

      markdown += "\n";
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SYNTHETIC AVAILABILITY METRICS SECTION
  // Shows synthetic monitors below threshold
  // ──────────────────────────────────────────────────────────────────────────
  const syntheticMetrics = sloData.syntheticMetrics || {};
  const syntheticSlos = sloData.slos.filter(slo => slo.isSynthetic);

  const syntheticSlosNeedingAttention = syntheticSlos.filter(slo => {
    const config = slo.syntheticConfig;
    if (!config) return false;

    const metrics = syntheticMetrics[config.syntheticId];
    if (!metrics || metrics.avgAvailability == null) return false;

    return metrics.avgAvailability < SYNTHETIC_AVAILABILITY_THRESHOLD;
  });

  if (syntheticSlos.length > 0) {
    markdown += "---\n\n";
    markdown += "## 🤖 Synthetic Availability Metrics (7-Day Totals)\n\n";
    markdown += "The following SLOs use Synthetic Monitoring instead of user actions.\n\n";
    markdown += "**Note:** Synthetic Monitor data will only display if availability falls beneath the SLO target of " + SYNTHETIC_AVAILABILITY_THRESHOLD + "%.\n\n";

    if (syntheticSlosNeedingAttention.length > 0) {
      for (const slo of syntheticSlosNeedingAttention) {
        const config = slo.syntheticConfig;
        const metrics = syntheticMetrics[config.syntheticId];

        markdown += "### " + slo.name + "\n\n";

        // Build clickable link for synthetic monitor
        const syntheticUrl = buildSyntheticUrl(config.syntheticId, config.type);
        const linkedMonitorName = syntheticUrl
          ? "[" + config.syntheticName + "](" + syntheticUrl + ")"
          : config.syntheticName;
        markdown += "**Synthetic Monitor:** " + linkedMonitorName + "\n\n";

        markdown += "| Metric | Value |\n";
        markdown += "|--------|-------|\n";
        markdown += "| **7-Day Avg Availability** | " + fmtSyntheticAvailability(metrics.avgAvailability, SYNTHETIC_AVAILABILITY_THRESHOLD) + " |\n";
        markdown += "| **SLO Target** | " + SYNTHETIC_AVAILABILITY_THRESHOLD + "% |\n";
        markdown += "| **Locations Monitored** | " + metrics.locationCount + " |\n";
        markdown += "\n";
      }
    } else {
      markdown += "✅ All Synthetic Monitors are meeting the availability target.\n\n";
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LEGEND
  // ──────────────────────────────────────────────────────────────────────────
  markdown += "---\n\n";
  markdown += "## Legend\n\n";
  markdown += "| Symbol | Meaning |\n";
  markdown += "|--------|----------|\n";
  markdown += "| ✅ | Meeting target / No errors |\n";
  markdown += "| ⚠️ | Warning / Low errors (1-" + ERROR_WARNING + ") / Slow (>" + (DURATION_WARNING_MS / 1000) + "s) |\n";
  markdown += "| ❌ | Below target / High errors (>" + ERROR_CRITICAL + ") / Very slow (>" + (DURATION_CRITICAL_MS / 1000) + "s) |\n";
  markdown += "| ➖ | No data available |\n";
  markdown += "| 📈 | Improving (current > 7 day) |\n";
  markdown += "| 📉 | Degrading (current < 7 day) |\n";
  markdown += "| ➡️ | Stable |\n";
  markdown += "\n";

  // ──────────────────────────────────────────────────────────────────────────
  // FOOTER
  // ──────────────────────────────────────────────────────────────────────────
  markdown += "---\n\n";
  markdown += "[View Dashboard in Dynatrace](" + sloData.dashboardUrl + ")\n";

  console.log("=== MARKDOWN OUTPUT ===");
  console.log(markdown.substring(0, 500) + "...");

  return {
    markdown: markdown,
    reportDate: sloData.reportDate
  };
}
