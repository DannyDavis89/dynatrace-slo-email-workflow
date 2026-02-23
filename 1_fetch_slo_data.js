// ============================================
// 1_fetch_slo_data.js
// SLO Data Fetcher - Collects SLO status, user action
// metrics, entity IDs, and synthetic availability data.
//
// This is the first task in the workflow. It gathers all
// data needed by the build_markdown_email task.
//
// SDK Clients Used:
//   - serviceLevelObjectivesClient: SLO status and targets
//   - rumUserSessionsClient: USQL queries for user action metrics
//   - monitoredEntitiesClient: Entity ID lookups for deep links
//   - metricsClient: Synthetic monitor availability
// ============================================

import { execution } from '@dynatrace-sdk/automation-utils';
import { serviceLevelObjectivesClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { rumUserSessionsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { monitoredEntitiesClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { metricsClient } from '@dynatrace-sdk/client-classic-environment-v2';

export default async function ({ execution_id }) {

  // ============================================
  // CONFIGURATION
  // TODO: Update all values below for your domain
  // ============================================

  // TODO: Add your SLO IDs here
  // Find these in Dynatrace: Service Level Objectives page > click SLO > ID in URL
  const sloIds = [
    // "your-slo-id-1",  // e.g., Application Apdex
    // "your-slo-id-2",  // e.g., Error-Free Rate
    // "your-slo-id-3",  // e.g., Key UA Performance
  ];

  // TODO: Update with your dashboard URL
  const dashboardUrl = "https://YOUR_TENANT.apps.dynatrace.com/ui/apps/dynatrace.classic.dashboards/#dashboard;gtf=-2h;gf=all;id=YOUR_DASHBOARD_ID";

  // TODO: Update with your Dynatrace application name (for USQL queries)
  // This must match the application name exactly as shown in Dynatrace
  const applicationName = "Your Application Name";

  // TODO: Configure synthetic SLO mappings (if applicable)
  // Map SLO IDs to their synthetic monitor details
  // Leave empty {} if you don't use synthetic SLOs
  const syntheticSloConfig = {
    // "synthetic-slo-id-1": {
    //   syntheticId: "SYNTHETIC_TEST-XXXXXXXXXXXX",
    //   syntheticName: "Your Monitor Name",
    //   type: "BROWSER"  // or "HTTP"
    // },
  };

  // Batching configuration
  // SLO API has a max pageSize of 25 when evaluate=true
  const SLO_BATCH_SIZE = 20;
  // USQL has query length limits, so batch user actions
  const USQL_BATCH_SIZE = 10;

  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  // Helper to split array into batches
  const batchArray = (array, batchSize) => {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  };

  // Helper to parse user action names from SLO filter expressions
  const parseUserActionsFromFilter = (filter) => {
    if (!filter) return [];

    const normalizedFilter = filter.replace(/\n/g, '').replace(/\s+/g, ' ');
    const userActions = [];

    // Match IN() syntax: entityname.in("action1","action2")
    const inMatch = normalizedFilter.match(/entityname\.in\s*\(\s*([^)]+)\)/i);
    if (inMatch) {
      const quotedStrings = inMatch[1].match(/"([^"]+)"/g);
      if (quotedStrings) {
        for (const qs of quotedStrings) {
          const action = qs.replace(/^"|"$/g, '');
          if (action && action.trim()) {
            userActions.push(action.trim());
          }
        }
      }
    }

    // Match equals() syntax: entityname.equals("action")
    const equalsMatch = normalizedFilter.match(/entityname\.equals\s*\(\s*"([^"]+)"\s*\)/i);
    if (equalsMatch) {
      userActions.push(equalsMatch[1].trim());
    }

    // Match contains() syntax: entityname.contains("action")
    const containsMatch = normalizedFilter.match(/entityname\.contains\s*\(\s*"([^"]+)"\s*\)/i);
    if (containsMatch) {
      userActions.push(containsMatch[1].trim());
    }

    return userActions;
  };

  // Helper to check if an SLO is synthetic-based
  const isSyntheticSlo = (sloId) => {
    return syntheticSloConfig.hasOwnProperty(sloId);
  };

  // ============================================
  // BATCHING SETUP
  // ============================================
  const sloBatches = batchArray(sloIds, SLO_BATCH_SIZE);
  console.log("Split " + sloIds.length + " SLOs into " + sloBatches.length + " batches");

  // ============================================
  // TIME PERIODS
  // These define the evaluation windows for SLO data
  // ============================================
  const timePeriods = [
    { name: "day90", from: "now-90d", to: "now" },
    { name: "day30", from: "now-30d", to: "now" },
    { name: "day7", from: "now-7d", to: "now" },
    { name: "current", from: "now-1d", to: "now" }
  ];

  // ============================================
  // FETCH SLO DATA (WITH BATCHING)
  // Fetches each SLO at each time period
  // ============================================
  const results = {};

  for (const period of timePeriods) {
    results[period.name] = [];

    for (let batchIndex = 0; batchIndex < sloBatches.length; batchIndex++) {
      const batch = sloBatches[batchIndex];
      const batchSelector = 'id("' + batch.join('","') + '")';

      try {
        const data = await serviceLevelObjectivesClient.getSlo({
          sloSelector: batchSelector,
          timeFrame: "GTF",
          from: period.from,
          to: period.to,
          pageSize: SLO_BATCH_SIZE,
          evaluate: true
        });

        const batchResults = data.slo || [];
        results[period.name] = results[period.name].concat(batchResults);

        console.log("Fetched batch " + (batchIndex + 1) + "/" + sloBatches.length + " for " + period.name + ": " + batchResults.length + " SLOs");
      } catch (error) {
        console.error("Error fetching " + period.name + " batch " + (batchIndex + 1) + ": " + error.message);
      }
    }

    console.log("Total " + period.name + ": " + results[period.name].length + " SLOs");
  }

  // ============================================
  // BUILD SLO REPORT
  // Combine all time periods into a single object per SLO
  // ============================================
  const sloReport = sloIds.map(id => {
    const slo90 = results.day90.find(s => s.id === id);
    const slo30 = results.day30.find(s => s.id === id);
    const slo7 = results.day7.find(s => s.id === id);
    const sloCurrent = results.current.find(s => s.id === id);

    // Use the most recent data for base info (name, target, filter)
    const baseSlo = sloCurrent || slo7 || slo30 || slo90;

    // Parse user actions from the SLO's metric expression filter
    const userActions = baseSlo ? parseUserActionsFromFilter(baseSlo.metricExpression) : [];

    // Check if this is a synthetic SLO
    const synthetic = isSyntheticSlo(id);

    return {
      id: id,
      name: baseSlo ? baseSlo.name : "Unknown SLO",
      target: baseSlo ? (baseSlo.target || 0) : 0,
      day90: slo90 ? { status: slo90.evaluatedPercentage, errorBudget: slo90.errorBudget } : null,
      day30: slo30 ? { status: slo30.evaluatedPercentage, errorBudget: slo30.errorBudget } : null,
      day7: slo7 ? { status: slo7.evaluatedPercentage, errorBudget: slo7.errorBudget } : null,
      current: sloCurrent ? { status: sloCurrent.evaluatedPercentage, errorBudget: sloCurrent.errorBudget } : null,
      userAction: userActions,
      isSynthetic: synthetic,
      syntheticConfig: synthetic ? syntheticSloConfig[id] : null
    };
  });

  console.log("Built report for " + sloReport.length + " SLOs");

  // ============================================
  // FETCH USER ACTION METRICS (USQL)
  // Queries completed user sessions for error counts
  // and average duration per user action
  // ============================================
  const allUserActions = [];
  for (const slo of sloReport) {
    if (!slo.isSynthetic && slo.userAction && slo.userAction.length > 0) {
      for (const ua of slo.userAction) {
        if (!allUserActions.includes(ua)) {
          allUserActions.push(ua);
        }
      }
    }
  }

  console.log("Total unique user actions to query: " + allUserActions.length);

  const userActionMetrics = {};

  if (allUserActions.length > 0) {
    const uaBatches = batchArray(allUserActions, USQL_BATCH_SIZE);
    console.log("Split " + allUserActions.length + " user actions into " + uaBatches.length + " USQL batches");

    for (let batchIndex = 0; batchIndex < uaBatches.length; batchIndex++) {
      const batch = uaBatches[batchIndex];

      // Build the IN() clause for this batch
      const inClause = batch.map(ua => '"' + ua.replace(/"/g, '\\"') + '"').join(', ');

      const query = 'SELECT name, ' +
        'AVG(duration) AS avg_duration, ' +
        'SUM(customErrorCount) AS total_customErrors, ' +
        'SUM(javascriptErrorCount) AS total_jsErrors, ' +
        'SUM(requestErrorCount) AS total_requestErrors ' +
        'FROM useraction ' +
        'WHERE application = "' + applicationName + '" ' +
        'AND name IN (' + inClause + ') ' +
        'GROUP BY name';

      try {
        const response = await rumUserSessionsClient.getUsqlResultAsTable({
          query: query,
          startTimestamp: Date.now() - (7 * 24 * 60 * 60 * 1000),
          endTimestamp: Date.now()
        });

        if (response.values) {
          for (const row of response.values) {
            const actionName = row[0];
            userActionMetrics[actionName] = {
              avgDuration: row[1] || 0,
              customErrors: row[2] || 0,
              jsErrors: row[3] || 0,
              requestErrors: row[4] || 0
            };
          }
        }

        console.log("USQL batch " + (batchIndex + 1) + "/" + uaBatches.length + ": " + (response.values ? response.values.length : 0) + " results");
      } catch (error) {
        console.error("USQL batch " + (batchIndex + 1) + " error: " + error.message);
      }
    }
  }

  // ============================================
  // FETCH USER ACTION ENTITY IDs (FOR DEEP LINKS)
  // Looks up entity IDs so we can build clickable URLs
  // Note: User actions must be marked as "Key User Actions"
  // in Dynatrace to receive entity IDs
  // ============================================
  const userActionEntities = {};

  for (const ua of allUserActions) {
    try {
      const response = await monitoredEntitiesClient.getEntities({
        entitySelector: 'type("KEY_USER_ACTION"),entityName("' + ua + '")',
        fields: '+fromRelationships',
        pageSize: 1
      });

      if (response.entities && response.entities.length > 0) {
        const entity = response.entities[0];
        let applicationId = null;

        // Get the parent application ID from relationships
        if (entity.fromRelationships && entity.fromRelationships.isActionOf) {
          for (const rel of entity.fromRelationships.isActionOf) {
            if (rel.id && rel.id.startsWith("APPLICATION-")) {
              applicationId = rel.id;
              break;
            }
          }
        }

        userActionEntities[ua] = {
          entityId: entity.entityId,
          applicationId: applicationId
        };
      }
    } catch (error) {
      // Entity not found - user action may not be a Key User Action
      console.log("No entity found for: " + ua.substring(0, 50) + "...");
    }
  }

  console.log("Found entities for " + Object.keys(userActionEntities).length + "/" + allUserActions.length + " user actions");

  // ============================================
  // FETCH SYNTHETIC AVAILABILITY (IF APPLICABLE)
  // Queries the metrics API for synthetic monitor
  // availability over the last 7 days
  // ============================================
  const syntheticMetrics = {};

  for (const [sloId, config] of Object.entries(syntheticSloConfig)) {
    try {
      const metricSelector = 'builtin:synthetic.browser.availability.location.total:filter(eq("dt.entity.synthetic_test","' + config.syntheticId + '")):avg';

      const response = await metricsClient.query({
        metricSelector: metricSelector,
        from: "now-7d",
        to: "now",
        resolution: "Inf"
      });

      if (response.result && response.result.length > 0) {
        const metric = response.result[0];
        if (metric.data && metric.data.length > 0) {
          const dataPoint = metric.data[0];
          const values = dataPoint.values || [];
          const validValues = values.filter(v => v != null);

          if (validValues.length > 0) {
            const avgAvailability = validValues.reduce((a, b) => a + b, 0) / validValues.length;
            syntheticMetrics[config.syntheticId] = {
              avgAvailability: avgAvailability,
              locationCount: validValues.length
            };
          }
        }
      }

      console.log("Synthetic " + config.syntheticName + ": " + (syntheticMetrics[config.syntheticId] ? syntheticMetrics[config.syntheticId].avgAvailability.toFixed(2) + "%" : "no data"));
    } catch (error) {
      console.error("Error fetching synthetic data for " + config.syntheticName + ": " + error.message);
    }
  }

  // ============================================
  // BUILD REPORT DATE
  // ============================================
  const now = new Date();
  const reportDate = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // ============================================
  // DETERMINE BREACH STATUS
  // Used by create_ado_ticket task condition
  // ============================================
  const hasBreach = sloReport.some(slo => {
    const day7Status = slo.day7 ? slo.day7.status : null;
    return day7Status != null && day7Status >= 0 && day7Status < slo.target;
  });

  // ============================================
  // RETURN ALL DATA
  // ============================================
  const output = {
    slos: sloReport,
    userActionMetrics: userActionMetrics,
    userActionEntities: userActionEntities,
    syntheticMetrics: syntheticMetrics,
    reportDate: reportDate,
    dashboardUrl: dashboardUrl,
    hasBreach: hasBreach
  };

  console.log("=== FETCH COMPLETE ===");
  console.log("SLOs: " + output.slos.length);
  console.log("User Action Metrics: " + Object.keys(output.userActionMetrics).length);
  console.log("User Action Entities: " + Object.keys(output.userActionEntities).length);
  console.log("Synthetic Metrics: " + Object.keys(output.syntheticMetrics).length);
  console.log("Has Breach: " + output.hasBreach);

  return output;
}
