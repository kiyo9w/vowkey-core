"use strict";
/* global DataTable, _post:readable, BASE_URL:readable, reload:readable, jdenticon:readable */

function deleteOrganization(event) {
    event.preventDefault();
    event.stopPropagation();
    const org_uuid = event.target.dataset.vwOrgUuid;
    const org_name = event.target.dataset.vwOrgName;
    const billing_email = event.target.dataset.vwBillingEmail;
    if (!org_uuid) {
        alert("Required parameters not found!");
        return false;
    }

    // First make sure the user wants to delete this organization
    const continueDelete = confirm(`WARNING: All data of this organization (${org_name}) will be lost!\nMake sure you have a backup, this cannot be undone!`);
    if (continueDelete == true) {
        const input_org_uuid = prompt(`To delete the organization "${org_name} (${billing_email})", please type the organization uuid below.`);
        if (input_org_uuid != null) {
            if (input_org_uuid == org_uuid) {
                _post(`${BASE_URL}/admin/organizations/${org_uuid}/delete`,
                    "Organization deleted correctly",
                    "Error deleting organization"
                );
            } else {
                alert("Wrong organization uuid, please try again");
            }
        }
    }
}

function initActions() {
    document.querySelectorAll("button[vw-delete-organization]").forEach(btn => {
        btn.addEventListener("click", deleteOrganization);
    });

    if (jdenticon) {
        jdenticon();
    }
}
let planOwner = "";
function grantPlan(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target).entries());
    data.quantity = Number(data.quantity);
    fetch(`${BASE_URL}/admin/${planOwner}/plan`, {
        method: "POST", body: JSON.stringify(data), mode: "same-origin", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }
    }).then(async (resp) => {
        if (resp.ok) { reload(); return; }
        const body = await resp.json().catch(() => ({}));
        document.getElementById("planGrantError").textContent = body.errorModel && body.errorModel.message || "The plan was not granted";
    }).catch(() => { document.getElementById("planGrantError").textContent = "The plan was not granted"; });
}

// onLoad events
document.addEventListener("DOMContentLoaded", (/*event*/) => {
    const columnCount = document.getElementById("orgs-table").querySelectorAll("thead th").length;
    new DataTable("#orgs-table", {
        "drawCallback": function () {
            initActions();
        },
        "stateSave": true,
        "responsive": true,
        "lengthMenu": [
            [-1, 5, 10, 25, 50],
            ["All", 5, 10, 25, 50]
        ],
        "pageLength": -1, // Default show all
        "columnDefs": [{
            "targets": [columnCount - 2, columnCount - 1], // Do not include the last two columns into the search/order features
            "searchable": false,
            "orderable": false
        }]
    });

    // Add click events for organization actions
    initActions();

    const btnReload = document.getElementById("reload");
    if (btnReload) {
        btnReload.addEventListener("click", reload);
    }
    const planGrantDialog = document.getElementById("planGrantDialog");
    planGrantDialog.addEventListener("show.bs.modal", function (event) {
        planOwner = `${event.relatedTarget.dataset.vwOwner}s/${event.relatedTarget.dataset.vwOwnerUuid}`;
        document.getElementById("planGrantName").textContent = event.relatedTarget.dataset.vwOwnerName;
        document.getElementById("planGrantError").textContent = "";
    });
    document.getElementById("planGrantForm").addEventListener("submit", grantPlan);
});
