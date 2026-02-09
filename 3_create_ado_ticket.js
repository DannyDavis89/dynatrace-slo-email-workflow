/**
 * ============================================================================
 * TASK 4: CREATE ADO TICKET (OPTIONAL)
 * ============================================================================
 * 
 * PURPOSE:
 * Automatically creates an Azure DevOps work item when SLOs breach their targets.
 * This enables automated incident tracking and team notification.
 * 
 * EXECUTION:
 * This task should be configured with a CONDITIONAL execution:
 *   {{ result('fetch_slo_data').hasBreach == true }}
 * 
 * This ensures tickets are only created when there's an actual breach.
 * 
 * PREREQUISITES:
 *   1. Azure DevOps PAT with "Work Items: Read & Write" scope
 *   2. PAT stored in Dynatrace Credential Vault
 *   3. dev.azure.com added to Dynatrace Allowed Outbound Connections
 *   4. User account has permissions on the target Area Path
 * 
 * ============================================================================
 */

import { execution } from '@dynatrace-sdk/automation-utils';
import { credentialVaultClient } from '@dynatrace-sdk/client-classic-environment-v2';

export default async function ({ execution_id }) {
  
  // ============================================================================
  // CONFIGURATION - MODIFY THIS SECTION FOR YOUR USE CASE
  // ============================================================================

  /**
   * Azure DevOps Organization and Project
   * 
   * HOW TO FIND:
   *   Your ADO URL looks like: https://dev.azure.com/{organization}/{project}
   */
  const adoOrganization = "YourOrganization";  // TODO: Replace with your ADO organization
  const adoProject = "YourProject";             // TODO: Replace with your ADO project

  /**
   * Area Path for Work Items
   * 
   * This determines where the work item appears in ADO.
   * Use backslashes to separate path segments.
   * 
   * HOW TO FIND:
   *   1. In ADO, go to Project Settings > Boards > Project Configuration
   *   2. Navigate to Areas tab
   *   3. Copy the full path
   * 
   * PERMISSIONS REQUIRED:
   *   The PAT user must have "Edit work items in this node" permission on this area path.
   */
  const areaPath = "YourProject\\Team\\SubArea";  // TODO: Replace with your area path
  // Example: "WealthManagement\\Core Wealth\\PrivatePassport\\P2-Deployables"

  /**
   * Work Item Type
   * 
   * Options: "Bug", "User Story", "Task", "Feature", "Epic", "Issue"
   * Must match exactly what's configured in your ADO process template.
   */
  const workItemType = "User Story";  // TODO: Change if needed

  /**
   * Credential Vault ID
   * 
   * The ID of the credential storing your Azure DevOps PAT.
   * 
   * HOW TO SET UP:
   *   1. Create a PAT in Azure DevOps with "Work Items: Read & Write" scope
   *   2. In Dynatrace, go to Settings > Credential Vault
   *   3. Add new credential:
   *      - Type: Token
   *      - Token: Your PAT value
   *      - Scope: APP_ENGINE (required for workflows)
   *   4. Copy the credential ID (CREDENTIALS_VAULT-XXXX)
   */
  const credentialVaultId = "CREDENTIALS_VAULT-XXXXXXXXXXXXXXXX";  // TODO: Replace with your credential ID

  /**
   * Tags (optional)
   * 
   * Tags to add to the work item for filtering/searching in ADO.
   * Separate multiple tags with semicolons.
   */
  const workItemTags = "SLO-Alert;Auto-Generated;Dynatrace";  // TODO: Customize tags

  /**
   * Report Domain Name
   * 
   * Used in the work item title and description for identification.
   */
  const domainName = "Your Domain";  // TODO: Replace with your domain name (e.g., "Settings & Authentication")

  // ============================================================================
  // MAIN EXECUTION - MODIFY ONLY IF YOU NEED DIFFERENT WORK ITEM CONTENT
  // ============================================================================

  console.log("=== CREATE ADO TICKET ===");

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 1: RETRIEVE DATA FROM PREVIOUS TASK
  // ──────────────────────────────────────────────────────────────────────────
  const ex = await execution(execution_id);
  const sloData = await ex.result('fetch_slo_data');

  console.log("SLO Data received, hasBreach: " + sloData.hasBreach);

  // Double-check breach status (belt and suspenders with the conditional)
  if (!sloData.hasBreach) {
    console.log("No breach detected, skipping ticket creation");
    return { 
      status: "skipped", 
      reason: "No SLO breach detected" 
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2: RETRIEVE PAT FROM CREDENTIAL VAULT
  // ──────────────────────────────────────────────────────────────────────────
  console.log("Retrieving PAT from Credential Vault...");

  let pat;
  try {
    const credential = await credentialVaultClient.getCredentialsDetails({
      id: credentialVaultId
    });

    pat = credential.token;

    if (!pat) {
      throw new Error("PAT token is empty or undefined");
    }

    console.log("PAT retrieved successfully");
  } catch (error) {
    console.error("Failed to retrieve PAT: " + error.message);
    return {
      status: "error",
      reason: "Failed to retrieve credentials: " + error.message
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 3: BUILD WORK ITEM CONTENT
  // ──────────────────────────────────────────────────────────────────────────

  // Identify failing SLOs
  const failingSlos = sloData.slos.filter(slo => {
    const status = slo.current?.status;
    return status != null && status >= 0 && status < slo.target;
  });

  console.log("Found " + failingSlos.length + " failing SLOs");

  // Build descriptive title
  const reportDate = sloData.reportDate;
  const sloNames = failingSlos.map(s => s.name).join(", ");
  const title = "[SLO Breach] " + domainName + " - " + reportDate + " - " + sloNames.substring(0, 100);

  // ┌─────────────────────────────────────────────────────────────────────────
  // │ BUILD WORK ITEM DESCRIPTION (HTML FORMAT)
  // │ Modify this section to change what appears in the work item
  // └─────────────────────────────────────────────────────────────────────────
  let description = "<h2>SLO Breach Alert</h2>";
  description += "<p><strong>Report Date:</strong> " + reportDate + "</p>";
  description += "<p><strong>Domain:</strong> " + domainName + "</p>";
  description += "<p><strong>Dashboard:</strong> <a href=\"" + sloData.dashboardUrl + "\">View in Dynatrace</a></p>";
  
  description += "<h3>Failing SLOs</h3>";
  description += "<table border=\"1\" cellpadding=\"5\" cellspacing=\"0\">";
  description += "<tr><th>SLO Name</th><th>Target</th><th>Current</th><th>Gap</th></tr>";

  for (const slo of failingSlos) {
    const currentStatus = slo.current?.status;
    const gap = currentStatus != null ? (slo.target - currentStatus).toFixed(2) : "N/A";
    
    description += "<tr>";
    description += "<td>" + slo.name + "</td>";
    description += "<td>" + slo.target + "%</td>";
    description += "<td>" + (currentStatus != null ? currentStatus.toFixed(2) + "%" : "N/A") + "</td>";
    description += "<td style=\"color: red;\">-" + gap + "%</td>";
    description += "</tr>";
  }

  description += "</table>";

  description += "<h3>Recommended Actions</h3>";
  description += "<ol>";
  description += "<li>Review the <a href=\"" + sloData.dashboardUrl + "\">SLO Dashboard</a> for details</li>";
  description += "<li>Check user action metrics for performance issues</li>";
  description += "<li>Investigate recent deployments or changes</li>";
  description += "<li>Coordinate with the development team for remediation</li>";
  description += "</ol>";

  description += "<hr/>";
  description += "<p><em>This work item was automatically generated by Dynatrace Workflows.</em></p>";

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 4: CREATE WORK ITEM VIA ADO REST API
  // ──────────────────────────────────────────────────────────────────────────

  // Encode work item type for URL (spaces become %20)
  const encodedWorkItemType = encodeURIComponent(workItemType);
  
  // Build API URL
  const adoUrl = "https://dev.azure.com/" + adoOrganization + "/" + adoProject + 
                 "/_apis/wit/workitems/$" + encodedWorkItemType + "?api-version=7.1";

  console.log("ADO API URL: " + adoUrl);

  // Build JSON Patch document (ADO work item format)
  const patchDocument = [
    {
      op: "add",
      path: "/fields/System.Title",
      value: title
    },
    {
      op: "add",
      path: "/fields/System.Description",
      value: description
    },
    {
      op: "add",
      path: "/fields/System.AreaPath",
      value: areaPath
    },
    {
      op: "add",
      path: "/fields/System.Tags",
      value: workItemTags
    }
  ];

  // ┌─────────────────────────────────────────────────────────────────────────
  // │ OPTIONAL: ADD ADDITIONAL FIELDS
  // │ Uncomment and modify to set other work item fields
  // └─────────────────────────────────────────────────────────────────────────
  
  // Assign to a specific user:
  // patchDocument.push({
  //   op: "add",
  //   path: "/fields/System.AssignedTo",
  //   value: "user@company.com"
  // });

  // Set iteration path:
  // patchDocument.push({
  //   op: "add",
  //   path: "/fields/System.IterationPath",
  //   value: "YourProject\\Sprint 1"
  // });

  // Set priority (1-4, where 1 is highest):
  // patchDocument.push({
  //   op: "add",
  //   path: "/fields/Microsoft.VSTS.Common.Priority",
  //   value: 2
  // });

  // Create Authorization header (Basic auth with empty username)
  const authHeader = "Basic " + btoa(":" + pat);

  console.log("Creating work item...");

  try {
    const response = await fetch(adoUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json-patch+json",
        "Authorization": authHeader
      },
      body: JSON.stringify(patchDocument)
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error("ADO API Error: " + response.status + " - " + responseText);
      
      // Provide helpful error messages
      if (response.status === 401) {
        return {
          status: "error",
          reason: "Authentication failed. Check that your PAT is valid and not expired."
        };
      } else if (response.status === 403) {
        return {
          status: "error",
          reason: "Permission denied. Ensure your user account has 'Edit work items in this node' permission on the area path: " + areaPath
        };
      } else if (response.status === 400) {
        return {
          status: "error",
          reason: "Bad request. Check area path and work item type. Details: " + responseText
        };
      }
      
      return {
        status: "error",
        reason: "ADO API returned " + response.status + ": " + responseText
      };
    }

    const result = JSON.parse(responseText);
    
    console.log("Work item created successfully!");
    console.log("Work Item ID: " + result.id);
    console.log("Work Item URL: " + result._links?.html?.href);

    return {
      status: "success",
      workItemId: result.id,
      workItemUrl: result._links?.html?.href || "https://dev.azure.com/" + adoOrganization + "/" + adoProject + "/_workitems/edit/" + result.id,
      title: title,
      failingSloCount: failingSlos.length
    };

  } catch (error) {
    console.error("Failed to create work item: " + error.message);
    return {
      status: "error",
      reason: "Request failed: " + error.message
    };
  }
}
