// ============================================
// 2_build_markdown_email.js
// SLO Email Report Builder - Markdown Generator
//
// This task transforms raw SLO data into a formatted
// markdown email report with trend analysis, user action
// metrics, and optional synthetic monitoring details.
//
// Prerequisites: Must run after fetch_slo_data task
// ============================================

import { execution } from '@dynatrace-sdk/automation-utils';

export default async function ({ execution_id }) {
  const ex = await execution(execution_id);
  const sloData = await ex.result('fetch_slo_data');

  console.log("=== BUILD MARKDOWN EMAIL ===");
  console.log("Number of SLOs received: " + sloData.slos.length);
  console.log("User action metrics received: " + Object.keys(sloData.userActionMetrics || {}).length);
  console.log("User action entities received: " + Object.keys(sloData.userActionEntities || {}).length);
  console.log("Synthetic metrics received: " + Object.keys(sloData.syntheticMetrics || {}).length);

  // ============================================
  // CONFIGURATION
  // TODO: Update these values for your domain
  // ============================================

  // TODO: Update report title and subtitle
  const reportTitle = "📊 SLO Report";
  const reportSubtitle = "Your Domain Name (Prod)"; // e.g., "Financial Picture (Prod)", "Collaboration (Prod)"

  // TODO: Update dashboard URLs for your environment
  const sloExplainedUrl = "https://YOUR_TENANT.apps.dynatrace.com/ui/apps/dynatrace.classic.dashboards/#dashboard;gtf=-1w;gf=all;id=YOUR_DASHBOARD_ID";
  const errorAnalysisUrl = ""; // Optional: URL to an error analysis dashboard

  // TODO: Update your Dynatrace tenant URL (used for deep links)
  const dynatraceTenantUrl = "https://YOUR_TENANT.apps.dynatrace.com";

  // TODO: If you have priority SLOs that should appear at the top of each category, list their IDs here
  // These are typically application-level SLOs (e.g., Application Apdex, Error-Free Rate)
  // Leave empty [] if you don't need priority ordering
  const prioritySloIds = [
    // "your-priority-slo-id-1", // e.g., Application Apdex
    // "your-priority-slo-id-2", // e.g., All User Action Error-Free Rate
  ];

  // Synthetic availability threshold (only show if below this)
  // TODO: Adjust if your synthetic SLOs have different targets
  const SYNTHETIC_AVAILABILITY_THRESHOLD = 99.98;

  // ============================================
  // HELPER FUNCTIONS
  // These generally don't need modification
  // ============================================

  // Helper to safely get nested property
  const safeGet = (obj, prop) => obj && obj[prop] !== undefined ? obj[prop] : null;

  // Helper to check if status is valid
  const isValidStatus = (val) => val != null && val !== undefined && val >= 0;

  // Helper to format status value
  const fmtStatus = (val) => {
    if (!isValidStatus(val)) return "N/A";
    return val.toFixed(2) + "%";
  };

  // Helper to get status emoji based on value vs target
  const getStatusEmoji = (val, target) => {
    if (!isValidStatus(val)) return "➖";
    if (val >= target) return "✅";
    if (val >= target * 0.95) return "⚠️";
    return "❌";
  };

  // Helper to get the "current" period data
  const getCurrent = (slo) => {
    if (slo.current) return slo.current;
    if (slo.daily) return slo.daily;
    return { status: null, errorBudget: null };
  };

  // ============================================
  // TREND CALCULATION
  // Evaluates direction across all 4 time windows:
  //   90d → 30d → 7d → current
  //
  // 📈 = ALL transitions going up (consistently improving)
  // 📉 = ALL transitions going down (consistently degrading)
  // ➡️ = ALL values stable (within threshold, no meaningful movement)
  // 〰️ = Mixed directions (fluctuating)
  // ============================================
  const getTrend = (slo) => {
    const current = getCurrent(slo);
    const values = [
      safeGet(slo.day90, 'status'),
      safeGet(slo.day30, 'status'),
      safeGet(slo.day7, 'status'),
      safeGet(current, 'status')
    ];

    // Filter to only valid values
    const valid = values.filter(v => isValidStatus(v));

    // Need at least 2 data points to determine a trend
    if (valid.length < 2) return "➖";

    // Threshold for considering two values "the same"
    // Near-zero: only floating-point rounding is ignored
    // Any real movement (even 0.01%) counts as directional
    const STABLE_THRESHOLD = 0.005;

    let ups = 0;
    let downs = 0;
    let flats = 0;

    for (let i = 0; i < valid.length - 1; i++) {
      const diff = valid[i + 1] - valid[i];

      if (Math.abs(diff) <= STABLE_THRESHOLD) {
        flats++;
      } else if (diff > 0) {
        ups++;
      } else {
        downs++;
      }
    }

    const transitions = valid.length - 1;

    // ALL transitions are flat = stable
    if (flats === transitions) return "➡️";

    // ALL non-flat transitions go up (flats are ok alongside ups)
    if (downs === 0 && ups > 0) return "📈";

    // ALL non-flat transitions go down (flats are ok alongside downs)
    if (ups === 0 && downs > 0) return "📉";

    // Mix of ups and downs = fluctuating
    return "〰️";
  };

  // Helper to format duration with emoji warning
  const fmtDurationWithEmoji = (ms) => {
    if (ms == null || ms === undefined) return "N/A";

    let formatted;
    if (ms < 1000) {
      formatted = Math.round(ms) + " ms";
    } else {
      formatted = (ms / 1000).toFixed(2) + " s";
    }

    if (ms > 12000) {
      return formatted + " ❌";
    } else if (ms > 3000) {
      return formatted + " ⚠️";
    }

    return formatted;
  };

  // Helper to get error emoji based on count
  const getErrorEmoji = (count) => {
    if (count == null || count === 0) return "";
    if (count <= 10) return " ⚠️";
    return " ❌";
  };

  // ============================================
  // USER ACTION NAME SHORTENING
  // TODO: Adjust the shortening logic if your user action
  // names follow a different pattern than the default
  // "click [button] landing on https://..." format
  // ============================================
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

  // Helper to build Dynatrace user action URL
  const buildUserActionUrl = (userAction, entities) => {
    if (!entities || !entities.entityId || !entities.applicationId) {
      return null;
    }

    const encodedName = userAction
      .replace(/ /g, '%20')
      .replace(/:/g, ':')
      .replace(/\/\//g, '%5C0%5C0')
      .replace(/\//g, '%5C0');

    // TODO: Update the base URL to match your Dynatrace tenant
    const baseUrl = dynatraceTenantUrl + "/ui/apps/dynatrace.classic.frontend/#uemapplications/uemuseractionmetrics";

    return baseUrl +
      ";uemuserActionId=" + entities.entityId +
      ";uaname=" + encodedName +
      ";uemapplicationId=" + entities.applicationId +
      ";gtf=-7d;gf=all";
  };

  // Helper to build Dynatrace synthetic monitor URL
  const buildSyntheticUrl = (syntheticId, type) => {
    if (!syntheticId) return null;

    // TODO: Update the base URL to match your Dynatrace tenant
    const baseUrl = dynatraceTenantUrl + "/ui/apps/dynatrace.classic.synthetic/ui";

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

  // Helper to check if a user action needs attention
  // TODO: Adjust thresholds if needed
  //   - totalErrors >= 10: flags user actions with 10+ combined errors
  //   - avgDuration >= 3000: flags user actions averaging 3+ seconds
  const needsAttention = (metrics) => {
    if (!metrics) return false;

    const totalErrors = (metrics.customErrors || 0) + (metrics.jsErrors || 0) + (metrics.requestErrors || 0);
    const avgDuration = metrics.avgDuration || 0;

    return totalErrors >= 10 || avgDuration >= 3000;
  };

  // Helper to calculate attention score for ranking
  const getAttentionScore = (metrics) => {
    if (!metrics) return 0;

    const totalErrors = (metrics.customErrors || 0) + (metrics.jsErrors || 0) + (metrics.requestErrors || 0);
    const avgDurationSeconds = (metrics.avgDuration || 0) / 1000;

    return (totalErrors * 10) + avgDurationSeconds;
  };

  // Helper to format synthetic availability with emoji
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

  // ============================================
  // SORT HELPER: Priority SLOs first, then alphabetical
  // Only applies if prioritySloIds is configured above
  // ============================================
  const sortWithPriority = (slos) => {
    if (prioritySloIds.length === 0) return slos.sort((a, b) => a.name.localeCompare(b.name));

    return slos.sort((a, b) => {
      const aIsPriority = prioritySloIds.includes(a.id);
      const bIsPriority = prioritySloIds.includes(b.id);

      if (aIsPriority && !bIsPriority) return -1;
      if (!aIsPriority && bIsPriority) return 1;

      if (aIsPriority && bIsPriority) {
        return prioritySloIds.indexOf(a.id) - prioritySloIds.indexOf(b.id);
      }

      return a.name.localeCompare(b.name);
    });
  };

  // ============================================
  // CATEGORIZE SLOs
  // Pass/fail is based on the 7-day value
  // This provides more stable alerting than daily fluctuations
  // ============================================
  const failingSLOs = sortWithPriority(
    sloData.slos.filter(slo => {
      const status = safeGet(slo.day7, "status");
      return isValidStatus(status) && status < slo.target;
    })
  );

  const passingSLOs = sortWithPriority(
    sloData.slos.filter(slo => {
      const status = safeGet(slo.day7, "status");
      return isValidStatus(status) && status >= slo.target;
    })
  );

  const noDataSLOs = sortWithPriority(
    sloData.slos.filter(slo => {
      const status = safeGet(slo.day7, "status");
      return !isValidStatus(status);
    })
  );

  console.log("Categorized: " + failingSLOs.length + " failing, " + passingSLOs.length + " passing, " + noDataSLOs.length + " no data");

  const breachStatus = failingSLOs.length > 0 ? "❌ BREACH" : "✅ OK";

  let markdown = "";

  // ============================================
  // REPORT HEADER
  // ============================================
  markdown += "# " + reportTitle + "\n\n";
  markdown += "## " + reportSubtitle + "\n\n";
  markdown += "**Report Date:** " + sloData.reportDate + "\n\n";

  markdown += "View SLO details and contributing factors on [dashboard](" + sloData.dashboardUrl + ")\n\n";
  markdown += "[SLOs explained](" + sloExplainedUrl + ")\n\n";

  // ============================================
  // EXECUTIVE SUMMARY
  // ============================================
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

  // ============================================
  // SLO TABLE BUILDER
  // Status emoji is based on the 7-day value
  // Optional note appears between heading and table
  // ============================================
  const buildSLOTable = (slos, title, note) => {
    if (slos.length === 0) return "";

    let table = "---\n\n";
    table += "## " + title + "\n\n";

    // Optional note between heading and table
    if (note) {
      table += "*" + note + "*\n\n";
    }

    table += "| SLO Name | Target | 90 Day | 30 Day | 7 Day | Current | Trend |\n";
    table += "|----------|--------|--------|--------|-------|---------|-------|\n";

    for (const slo of slos) {
      const current = getCurrent(slo);
      const currentStatus = safeGet(current, "status");
      const day7Status = safeGet(slo.day7, "status");

      // Emoji reflects 7-day status vs target
      const emoji = getStatusEmoji(day7Status, slo.target);
      const trend = getTrend(slo);

      table += "| " + emoji + " " + slo.name +
        " | " + slo.target + "%" +
        " | " + fmtStatus(safeGet(slo.day90, "status")) +
        " | " + fmtStatus(safeGet(slo.day30, "status")) +
        " | " + fmtStatus(day7Status) +
        " | " + fmtStatus(currentStatus) +
        " | " + trend +
        " |\n";
    }

    return table + "\n";
  };

  // ============================================
  // SLO TABLES
  // ============================================
  if (failingSLOs.length > 0) {
    markdown += buildSLOTable(failingSLOs, "❌ SLOs Below Target (Action Required)", "Categorization is based on the 7-day value.");
  }

  if (passingSLOs.length > 0) {
    markdown += buildSLOTable(passingSLOs, "✅ SLOs Meeting Target");
  }

  if (noDataSLOs.length > 0) {
    markdown += buildSLOTable(noDataSLOs, "➖ SLOs With No Data");
  }

  // ============================================
  // USER ACTION METRICS SECTION
  // Shows user actions that need attention:
  //   - 10+ total errors across all error types
  //   - 3+ second average duration
  // Top 3 actions per SLO, ranked by severity score
  // ============================================
  const userActionMetrics = sloData.userActionMetrics || {};
  const userActionEntities = sloData.userActionEntities || {};

  const slosWithActionableUserActions = sloData.slos.filter(slo => {
    // Skip synthetic SLOs - they don't have user actions
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

    // TODO: Add error analysis dashboard link if available
    if (errorAnalysisUrl) {
      markdown += "View detailed error analysis [dashboard](" + errorAnalysisUrl + ").\n\n";
    }

    markdown += "The following user actions need attention (≥10 total errors OR ≥3s avg duration).\n\n";
    markdown += "**Note:** Click on the user action names to view them in Dynatrace. Metrics below are based on completed user sessions and combine all action types (XHR, Load, or Route Change) with the same name, which may result in different averages than the Dynatrace UI where these are displayed separately.\n\n";

    for (const slo of slosWithActionableUserActions) {
      const userActions = Array.isArray(slo.userAction) ? slo.userAction : [slo.userAction];

      const actionsNeedingAttention = userActions.filter(ua => {
        const metrics = userActionMetrics[ua];
        return metrics && needsAttention(metrics);
      });

      if (actionsNeedingAttention.length === 0) continue;

      // Rank by severity score and show top 3
      const sortedActions = actionsNeedingAttention
        .map(ua => ({ userAction: ua, metrics: userActionMetrics[ua], score: getAttentionScore(userActionMetrics[ua]) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

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

  // ============================================
  // SYNTHETIC AVAILABILITY METRICS SECTION
  // Only included if your workflow has synthetic SLOs
  // If you don't use synthetic monitors, this section
  // will be automatically skipped
  // ============================================
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

  // ============================================
  // LEGEND
  // ============================================
  markdown += "---\n\n";
  markdown += "## Legend\n\n";
  markdown += "| Symbol | Meaning |\n";
  markdown += "|--------|----------|\n";
  markdown += "| ✅ | Meeting target / No errors |\n";
  markdown += "| ⚠️ | Warning / Low errors (1-10) / Slow (>3s) |\n";
  markdown += "| ❌ | Below target / High errors (>10) / Very slow (>12s) |\n";
  markdown += "| ➖ | No data available |\n";
  markdown += "| 📈 | Consistently improving (all windows trending up) |\n";
  markdown += "| 📉 | Consistently degrading (all windows trending down) |\n";
  markdown += "| ➡️ | Stable (no meaningful change across windows) |\n";
  markdown += "| 〰️ | Fluctuating (mixed up/down movement across windows) |\n";
  markdown += "\n";

  markdown += "---\n\n";
  markdown += "[View Dashboard in Dynatrace](" + sloData.dashboardUrl + ")\n";

  console.log("=== MARKDOWN OUTPUT ===");
  console.log(markdown.substring(0, 500) + "...");

  return {
    markdown: markdown,
    reportDate: sloData.reportDate
  };
}
