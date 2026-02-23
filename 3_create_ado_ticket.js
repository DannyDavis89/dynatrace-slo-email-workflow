// ============================================
// 3_create_ado_ticket.js
// Azure DevOps Work Item Creator
//
// Creates a work item in Azure DevOps when SLOs breach
// their targets. Only runs when the workflow condition
// evaluates to true:
//   {{ result('fetch_slo_data').hasBreach == true }}
//
// Prerequisites:
//   - Azure DevOps Personal Access Token (PAT) stored
//     in Dynatrace Credential Vault
//   - PAT must have "Work Items: Read & Write" scope
// ============================================

import { execution } from '@dynatrace-sdk/automation-utils';
import { credentialVaultClient } from '@dynatrace-sdk/client-classic-environment-v2';

export default async function ({ execution_id }) {
  const ex = await execution(execution_id);
  const sloData = await ex.result('fetch_slo_data');

  // ============================================
  // CONFIGURATION
  // TODO: Update all values below for your organization
  // ============================================

  // TODO: Azure DevOps organization name
  // Found in your ADO URL: https://dev.azure.com/{organization}
  const adoOrganization = "YOUR_ADO_ORGANIZATION";

  // TODO: Azure DevOps project name
  const adoProject = "YOUR_ADO_PROJECT";

  // TODO: Dynatrace Credential Vault ID for your ADO Personal Access Token
  // Create in Dynatrace: Settings > Integration > Credential vault
  // Store your PAT with scope "Work Items: Read & Write"
  const adoPatCredentialId = "CREDENTIALS_VAULT-XXXXXXXXXXXXXXXX";

  // TODO: Area path for the work item (use \\ for path separators)
  const areaPath = "YourProject\\YourTeam";

  // TODO: Work item type to create
  const workItemType = "Bug"; // Options: "Bug", "Task", "User Story", etc.

  // TODO: Tags to apply to the work item (comma-separated)
  const tags = "SLO-Breach;Automated";

  // ============================================
  // RETRIEVE PAT FROM CREDENTIAL VAULT
  // ============================================
  console.log("Retrieving ADO PAT from Credential Vault...");

  let adoPat;
  try {
    const credential = await credentialVaultClient.getCredentialsDetails({
      id: adoPatCredentialId
    });
    adoPat = credential.token;

    if (!adoPat) {
      console.error("PAT retrieved but token is empty");
      return { status: "error", reason: "Empty PAT token" };
    }
    console.log("PAT retrieved successfully");
  } catch (error) {
    console.error("Failed to retrieve PAT: " + error.message);
    return {
      status: "error",
      reason: "Failed to retrieve PAT from Credential Vault. Verify credential ID: " + adoPatCredentialId
    };
  }

  // ============================================
  // BUILD WORK ITEM CONTENT
  // ============================================

  // Find failing SLOs (based on 7-day value)
  const failingSlos = sloData.slos.filter(slo => {
    const day7Status = slo.day7 ? slo.day7.status : null;
    return day7Status != null && day7Status >= 0 && day7Status < slo.target;
  });

  if (failingSlos.length === 0) {
    console.log("No failing SLOs found. Skipping work item creation.");
    return { status: "skipped", reason: "No SLOs below target" };
  }

  console.log("Found " + failingSlos.length + " failing SLOs");

  // Build title
  const title = "SLO Breach Alert - " + failingSlos.length + " SLO(s) Below Target - " + sloData.reportDate;

  // Build description with failing SLO details
  let description = "<h2>SLO Breach Report - " + sloData.reportDate + "</h2>";
  description += "<p><strong>" + failingSlos.length + " SLO(s)</strong> are currently below their target.</p>";
  description += "<table border='1' cellpadding='5' cellspacing='0'>";
  description += "<tr><th>SLO Name</th><th>Target</th><th>7-Day Status</th><th>Current Status</th></tr>";

  for (const slo of failingSlos) {
    const day7Status = slo.day7 ? slo.day7.status.toFixed(2) + "%" : "N/A";
    const currentStatus = slo.current ? slo.current.status.toFixed(2) + "%" : "N/A";

    description += "<tr>";
    description += "<td>" + slo.name + "</td>";
    description += "<td>" + slo.target + "%</td>";
    description += "<td>" + day7Status + "</td>";
    description += "<td>" + currentStatus + "</td>";
    description += "</tr>";
  }

  description += "</table>";
  description += "<br><p><a href='" + sloData.dashboardUrl + "'>View Dashboard in Dynatrace</a></p>";
  description += "<p><em>This work item was created automatically by the SLO monitoring workflow.</em></p>";

  // ============================================
  // CREATE WORK ITEM VIA ADO REST API
  // ============================================
  const adoUrl = "https://dev.azure.com/" + adoOrganization + "/" + adoProject + "/_apis/wit/workitems/$" + workItemType + "?api-version=7.0";

  const body = [
    { op: "add", path: "/fields/System.Title", value: title },
    { op: "add", path: "/fields/System.Description", value: description },
    { op: "add", path: "/fields/System.AreaPath", value: areaPath },
    { op: "add", path: "/fields/System.Tags", value: tags },
    { op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: 2 }
  ];

  console.log("Creating work item in ADO...");
  console.log("URL: " + adoUrl);
  console.log("Title: " + title);

  try {
    const authHeader = "Basic " + btoa(":" + adoPat);

    const response = await fetch(adoUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json-patch+json",
        "Authorization": authHeader
      },
      body: JSON.stringify(body)
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error("ADO API error: " + response.status);
      console.error("Response: " + responseText);

      if (response.status === 401) {
        return {
          status: "error",
          reason: "Authentication failed. Check that your PAT is valid and not expired."
        };
      } else if (response.status === 403) {
        return {
          status: "error",
          reason: "Permission denied. Ensure your PAT has 'Work Items: Read & Write' scope and your account has 'Edit work items' permission on the area path: " + areaPath
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
