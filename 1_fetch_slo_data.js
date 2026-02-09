/**
 * ============================================================================
 * TASK 1: FETCH SLO DATA
 * ============================================================================
 * 
 * PURPOSE:
 * This task fetches all raw data needed for the SLO report:
 *   - SLO status across multiple time periods (90-day, 30-day, 7-day, current)
 *   - User action performance metrics (duration, error counts)
 *   - Entity IDs for creating clickable deep links
 *   - Synthetic monitor availability data
 * 
 * OUTPUT:
 * Returns a JSON object consumed by the build_markdown_email task
 * 
 * PREREQUISITES:
 *   - SLOs must exist and be configured in Dynatrace
 *   - User actions should be marked as "Key User Actions" for deep linking
 *   - Synthetic monitors must be active (if using synthetic SLOs)
 * 
 * ============================================================================
 */

import { serviceLevelObjectivesClient, monitoredEntitiesClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { rumUserSessionsClient } from "@dynatrace-sdk/client-classic-environment-v1";
import { metricsClient } from "@dynatrace-sdk/client-classic-environment-v2";

export default async function ({ execution_id }) {

  // ============================================================================
  // CONFIGURATION - MODIFY THIS SECTION FOR YOUR USE CASE
  // ============================================================================

  /**
   * SLO IDs to monitor
   * 
   * HOW TO FIND SLO IDs:
   *   1. Open the SLO in Dynatrace
   *   2. Look at the URL: https://your-tenant.apps.dynatrace.com/#slo;id=<SLO_ID>
   *   3. Copy the ID portion
   * 
   * Or use the API:
   *   GET /api/v2/slo
   */
  const sloIds = [
    // ┌─────────────────────────────────────────────────────────────────────────
    // │ ADD YOUR SLO IDs HERE
    // │ Example: "cc08364e-4037-3cc0-8a45-6b07288a1e1a"
    // └─────────────────────────────────────────────────────────────────────────
    "your-slo-id-1",  // TODO: Replace with actual SLO ID - Description of SLO
    "your-slo-id-2",  // TODO: Replace with actual SLO ID - Description of SLO
    // Add more SLO IDs as needed...
  ];

  /**
   * Synthetic Monitor Configuration
   * 
   * Use this for SLOs that are based on Synthetic Monitors rather than
   * real user actions. These require special handling to fetch availability.
   * 
   * HOW TO FIND SYNTHETIC IDs:
   *   1. Open the synthetic monitor in Dynatrace
   *   2. Look at the URL: https://...synthetic/ui/browser-monitor/<SYNTHETIC_ID>
   *   3. Copy the SYNTHETIC_TEST-XXXX portion
   * 
   * TYPE OPTIONS:
   *   - "BROWSER" - For browser clickpath monitors
   *   - "HTTP"    - For HTTP availability monitors
   */
  const syntheticSloConfig = {
    // ┌─────────────────────────────────────────────────────────────────────────
    // │ ADD SYNTHETIC SLO MAPPINGS HERE
    // │ Key = SLO ID (must also be in sloIds array above)
    // │ Value = Synthetic monitor details
    // └─────────────────────────────────────────────────────────────────────────
    
    // Example (uncomment and modify):
    // "your-synthetic-slo-id": {
    //   syntheticId: "SYNTHETIC_TEST-XXXXXXXXXXXXXXXX",
    //   syntheticName: "Your Monitor Name",
    //   type: "BROWSER"  // or "HTTP"
    // },
  };

  /**
   * Dashboard URL
   * 
   * Link to the dashboard that provides detailed SLO information.
   * This URL will be included in the email report for easy access.
   * 
   * HOW TO FIND:
   *   1. Open your dashboard in Dynatrace
   *   2. Copy the full URL from the browser
   */
  const dashboardUrl = "https://YOUR-TENANT.apps.dynatrace.com/ui/apps/dynatrace.classic.dashboards/#dashboard;gtf=-1w;gf=all;id=YOUR-DASHBOARD-ID";
  // TODO: Replace with your actual dashboard URL

  // ============================================================================
  // ADVANCED CONFIGURATION - MODIFY ONLY IF NEEDED
  // ============================================================================

  /**
   * Dynatrace API Limits
   * 
   * SLO_BATCH_SIZE: Max SLOs per API request (Dynatrace limit is 25)
   * USQL_BATCH_SIZE: Max user actions per USQL query (keep small to avoid 414 errors)
   */
  const SLO_BATCH_SIZE = 25;
  const USQL_BATCH_SIZE = 10;  // Reduce if you have very long user action names

  /**
   * Time Periods for Trend Analysis
   * 
   * These periods are used to show SLO trends over time.
   * Modify if you need different time windows.
   */
  const timePeriods = [
    { name: "day90", from: "now-90d", to: "now" },
    { name: "day30", from: "now-30d", to: "now" },
    { name: "day7", from: "now-7d", to: "now" },
    { name: "current", from: "now-1d", to: "now" }
  ];

  // ============================================================================
  // HELPER FUNCTIONS - DO NOT MODIFY UNLESS NECESSARY
  // ============================================================================

  /**
   * Splits an array into smaller batches
   * Used to respect API limits
   */
  const batchArray = (array, batchSize) => {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  };

  /**
   * Extracts user action names from SLO filter expressions
   * 
   * Supports these filter formats:
   *   - entityname.in("action1","action2")
   *   - entityname.equals("action")
   *   - entityname.contains("partial")
   */
  const parseUserActionsFromFilter = (filter) => {
    if (!filter) return [];

    const normalizedFilter = filter.replace(/\n/g, '').replace(/\s+/g, ' ');
    const userActions = [];

    // Parse entityname.in("action1","action2",...)
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

    // Parse entityname.equals("action")
    const equalsMatch = normalizedFilter.match(/entityname\.equals\s*\(\s*"([^"]+)"\s*\)/i);
    if (equalsMatch) {
      userActions.push(equalsMatch[1].trim());
    }

    // Parse entityname.contains("partial")
    const containsMatch = normalizedFilter.match(/entityname\.contains\s*\(\s*"([^"]+)"\s*\)/i);
    if (containsMatch) {
      userActions.push(containsMatch[1].trim());
    }

    return userActions;
  };

  /**
   * Checks if an SLO is synthetic-based
   */
  const isSyntheticSlo = (sloId) => {
    return syntheticSloConfig.hasOwnProperty(sloId);
  };

  // ============================================================================
  // MAIN EXECUTION - DO NOT MODIFY UNLESS NECESSARY
  // ============================================================================

  // Setup batching for SLO requests
  const sloBatches = batchArray(sloIds, SLO_BATCH_SIZE);
  console.log("Split " + sloIds.length + " SLOs into " + sloBatches.length + " batches");

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 1: FETCH SLO STATUS DATA
  // Queries each SLO across all time periods to build trend data
  // ──────────────────────────────────────────────────────────────────────────
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

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2: BUILD SLO REPORT STRUCTURE
  // Combines data from all time periods into a unified report structure
  // ──────────────────────────────────────────────────────────────────────────
  const sloReport = sloIds.map(id => {
    const slo90 = results.day90.find(s => s.id === id);
    const slo30 = results.day30.find(s => s.id === id);
    const slo7 = results.day7.find(s => s.id === id);
    const sloCurrent = results.current.find(s => s.id === id);

    const baseSlo = sloCurrent || slo7 || slo30 || slo90;
    const isSynthetic = isSyntheticSlo(id);
    const userActions = isSynthetic ? [] : parseUserActionsFromFilter(baseSlo?.filter);
    const syntheticConfig = isSynthetic ? syntheticSloConfig[id] : null;

    return {
      id: id,
      name: baseSlo?.name || "Unknown SLO",
      target: baseSlo?.target || 0,
      filter: baseSlo?.filter || null,
      userAction: userActions,
      isSynthetic: isSynthetic,
      syntheticConfig: syntheticConfig,
      day90: { status: slo90?.evaluatedPercentage, errorBudget: slo90?.errorBudget },
      day30: { status: slo30?.evaluatedPercentage, errorBudget: slo30?.errorBudget },
      day7: { status: slo7?.evaluatedPercentage, errorBudget: slo7?.errorBudget },
      current: { status: sloCurrent?.evaluatedPercentage, errorBudget: sloCurrent?.errorBudget }
    };
  });

  console.log("Total SLOs processed: " + sloReport.length);

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 3: FETCH USER ACTION METRICS
  // Uses USQL to get performance data (duration, errors) for each user action
  // ──────────────────────────────────────────────────────────────────────────
  const userActionNames = [...new Set(
    sloReport
      .filter(slo => !slo.isSynthetic)
      .flatMap(slo => slo.userAction)
      .filter(ua => ua !== null && ua !== undefined && ua.length > 0)
  )];

  console.log("Found " + userActionNames.length + " unique user actions across non-synthetic SLOs");

  let userActionMetrics = {};

  if (userActionNames.length > 0) {
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

    const userActionBatches = batchArray(userActionNames, USQL_BATCH_SIZE);
    console.log("Split " + userActionNames.length + " user actions into " + userActionBatches.length + " USQL batches");

    for (let batchIndex = 0; batchIndex < userActionBatches.length; batchIndex++) {
      const batch = userActionBatches[batchIndex];

      try {
        const userActionList = batch.map(ua => "'" + ua.replace(/'/g, "\\'") + "'").join(',');

        const usqlQuery = "SELECT name, " +
          "AVG(duration) AS avg_duration, " +
          "SUM(customErrorCount) AS total_customErrors, " +
          "SUM(javascriptErrorCount) AS total_jsErrors, " +
          "SUM(requestErrorCount) AS total_requestErrors, " +
          "COUNT(*) AS action_count " +
          "FROM useraction " +
          "WHERE name IN (" + userActionList + ") " +
          "GROUP BY name";

        console.log("USQL batch " + (batchIndex + 1) + "/" + userActionBatches.length + ": querying " + batch.length + " user actions");

        const usqlData = await rumUserSessionsClient.getUsqlResultAsTable({
          query: usqlQuery,
          startTimestamp: sevenDaysAgo,
          endTimestamp: now
        });

        if (usqlData && usqlData.values && usqlData.values.length > 0) {
          const columns = usqlData.columnNames;
          const getIndex = (name) => columns.indexOf(name);

          for (const row of usqlData.values) {
            const name = row[getIndex('name')];
            userActionMetrics[name] = {
              avgDuration: row[getIndex('avg_duration')],
              customErrors: row[getIndex('total_customErrors')] || 0,
              jsErrors: row[getIndex('total_jsErrors')] || 0,
              requestErrors: row[getIndex('total_requestErrors')] || 0,
              actionCount: row[getIndex('action_count')] || 0
            };
          }
          console.log("  Retrieved metrics for " + usqlData.values.length + " user actions");
        } else {
          console.log("  No data returned for batch " + (batchIndex + 1));
        }
      } catch (error) {
        console.error("USQL Error batch " + (batchIndex + 1) + ": " + error.message);
      }
    }

    console.log("Total user action metrics: " + Object.keys(userActionMetrics).length);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 4: FETCH USER ACTION ENTITY IDs FOR DEEP LINKS
  // Looks up APPLICATION_METHOD entity IDs to create clickable Dynatrace links
  // 
  // NOTE: Only "Key User Actions" have entity IDs. If links aren't working,
  //       mark the user action as a Key User Action in Dynatrace.
  // ──────────────────────────────────────────────────────────────────────────
  let userActionEntities = {};

  if (userActionNames.length > 0) {
    console.log("Fetching entity IDs for " + userActionNames.length + " user actions...");

    for (const userActionName of userActionNames) {
      try {
        const escapedName = userActionName.replace(/"/g, '\\"');
        const entitySelector = 'type("APPLICATION_METHOD"),entityName.equals("' + escapedName + '")';

        const response = await monitoredEntitiesClient.getEntities({
          entitySelector: entitySelector,
          from: "now-7d",
          to: "now",
          fields: "+fromRelationships"
        });

        if (response.entities && response.entities.length > 0) {
          for (const entity of response.entities) {
            const applicationId = entity.fromRelationships?.isApplicationMethodOf?.[0]?.id;

            if (applicationId) {
              userActionEntities[userActionName] = {
                entityId: entity.entityId,
                applicationId: applicationId
              };
              console.log("  Found: " + userActionName.substring(0, 50) + "... -> " + entity.entityId);
              break;
            }
          }
        }
      } catch (error) {
        console.error("Error fetching entity for: " + userActionName.substring(0, 50) + "... - " + error.message);
      }
    }

    console.log("Entity mappings created: " + Object.keys(userActionEntities).length);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 5: FETCH SYNTHETIC MONITOR AVAILABILITY
  // For synthetic-based SLOs, fetches 7-day availability metrics
  // ──────────────────────────────────────────────────────────────────────────
  let syntheticMetrics = {};

  const syntheticSlos = sloReport.filter(slo => slo.isSynthetic);
  console.log("Found " + syntheticSlos.length + " Synthetic SLOs");

  for (const slo of syntheticSlos) {
    const config = slo.syntheticConfig;
    if (!config) continue;

    try {
      const metricSelector = 'builtin:synthetic.browser.availability.location.total:filter(eq("dt.entity.synthetic_test","' + config.syntheticId + '")):avg';

      console.log("Querying synthetic availability for: " + config.syntheticName);

      const response = await metricsClient.query({
        metricSelector: metricSelector,
        from: "now-7d",
        to: "now",
        resolution: "Inf",
        acceptType: "application/json; charset=utf-8"
      });

      if (response.result && response.result.length > 0 && response.result[0].data) {
        const dataPoints = response.result[0].data;

        let totalAvailability = 0;
        let locationCount = 0;
        const locationDetails = [];

        for (const dataPoint of dataPoints) {
          const availability = dataPoint.values[0];
          if (availability != null) {
            totalAvailability += availability;
            locationCount++;
            locationDetails.push({
              locationId: dataPoint.dimensionMap["dt.entity.geolocation"] || "Unknown",
              availability: availability
            });
          }
        }

        const avgAvailability = locationCount > 0 ? totalAvailability / locationCount : null;

        syntheticMetrics[config.syntheticId] = {
          syntheticName: config.syntheticName,
          syntheticId: config.syntheticId,
          type: config.type,
          avgAvailability: avgAvailability,
          locationCount: locationCount,
          locationDetails: locationDetails
        };

        console.log("  " + config.syntheticName + " - Avg Availability: " + (avgAvailability ? avgAvailability.toFixed(2) + "%" : "N/A"));
      } else {
        console.log("  No synthetic data returned for: " + config.syntheticName);
      }
    } catch (error) {
      console.error("Synthetic metrics error for " + config.syntheticName + ": " + error.message);
    }
  }

  console.log("Total synthetic metrics: " + Object.keys(syntheticMetrics).length);

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 6: PREPARE OUTPUT
  // Bundles all data for the build_markdown_email task
  // ──────────────────────────────────────────────────────────────────────────
  const reportDate = new Date().toISOString().split('T')[0];
  
  // Check if any SLO is breaching (used to trigger ADO ticket creation)
  const hasBreach = sloReport.some(slo => {
    const status = slo.current.status;
    return status != null && status >= 0 && status < slo.target;
  });

  console.log("=== SUMMARY ===");
  console.log("Report Date: " + reportDate);
  console.log("Total SLOs: " + sloReport.length);
  console.log("User Actions with metrics: " + Object.keys(userActionMetrics).length);
  console.log("User Action Entities: " + Object.keys(userActionEntities).length);
  console.log("Synthetic monitors with metrics: " + Object.keys(syntheticMetrics).length);
  console.log("Has Breach: " + hasBreach);

  return {
    reportDate: reportDate,
    slos: sloReport,
    userActionMetrics: userActionMetrics,
    userActionEntities: userActionEntities,
    syntheticMetrics: syntheticMetrics,
    hasBreach: hasBreach,
    dashboardUrl: dashboardUrl
  };
}
