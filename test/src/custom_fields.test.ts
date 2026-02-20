import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("Custom Fields", async () => {
  test("GET /custom_fields.json", async () => {
    const response = await client.GET("/custom_fields.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);

    const customFields = response.data!.custom_fields;
    assert(customFields.length > 0, "Expected at least one custom field");

    // Verify field_format values are present
    const formats = new Set<string>(customFields.map((cf) => cf.field_format));
    for (const expected of ["string", "text", "int", "float", "date", "bool", "link", "list"]) {
      assert(formats.has(expected), `Expected field_format '${expected}' in custom fields`);
    }

    // Verify IssueCustomField has trackers and roles
    const issueCf = customFields.find(
      (cf) => cf.customized_type === "issue" && cf.trackers !== undefined
    );
    assert(issueCf, "Expected at least one issue custom field with trackers");
    assert(Array.isArray(issueCf!.trackers), "trackers should be an array");
    assert(Array.isArray(issueCf!.roles), "roles should be an array");

    // Verify list field has possible_values
    const listCf = customFields.find(
      (cf) => cf.field_format === "list" && cf.possible_values !== undefined
    );
    assert(listCf, "Expected a list custom field with possible_values");
    assert(
      Array.isArray(listCf!.possible_values),
      "possible_values should be an array"
    );
    assert(
      listCf!.possible_values!.length > 0,
      "possible_values should not be empty"
    );

    // Verify multiple field exists
    const multiCf = customFields.find((cf) => cf.multiple === true);
    assert(multiCf, "Expected at least one multiple custom field");

    // Verify non-issue custom fields do NOT have trackers/roles
    const projectCf = customFields.find(
      (cf) => cf.customized_type === "project"
    );
    if (projectCf) {
      assert.strictEqual(
        projectCf.trackers,
        undefined,
        "Project custom field should not have trackers"
      );
      assert.strictEqual(
        projectCf.roles,
        undefined,
        "Project custom field should not have roles"
      );
    }
  });

  // Test custom fields in issues (various types)
  describe("Issue custom fields", async () => {
    let projectId: number;
    let versionId: number;
    let issueId: number;
    let cfIds: Record<string, number>;

    before(async () => {
      // Create project
      const projectName = `cf-test-${Date.now()}`;
      const projectRes = await client.POST("/projects.{format}", {
        params: { path: { format: "json" } },
        body: {
          project: {
            name: projectName,
            identifier: projectName,
            enabled_module_names: ["issue_tracking"],
          },
        },
      });
      assertStatus(201, projectRes);
      projectId = projectRes.data!.project.id;

      // Get first role ID
      const rolesRes = await client.GET("/roles.{format}", {
        params: { path: { format: "json" } },
      });
      assertStatus(200, rolesRes);
      const roleId = rolesRes.data!.roles[0].id;

      // Add admin user as project member (needed for user custom field)
      const memberRes = await client.POST(
        "/projects/{project_id}/memberships.{format}",
        {
          params: { path: { format: "json", project_id: projectId } },
          body: { membership: { user_id: 1, role_ids: [roleId] } },
        }
      );
      assertStatus(201, memberRes);

      // Create version for version custom field
      const versionRes = await client.POST(
        "/projects/{project_id}/versions.{format}",
        {
          params: { path: { format: "json", project_id: projectId } },
          body: { version: { name: "v1.0" } },
        }
      );
      assertStatus(201, versionRes);
      versionId = versionRes.data!.version.id;

      // Get custom field IDs by name
      const cfRes = await client.GET("/custom_fields.{format}", {
        params: { path: { format: "json" } },
      });
      assertStatus(200, cfRes);
      cfIds = {};
      for (const cf of cfRes.data!.custom_fields) {
        cfIds[cf.name] = cf.id;
      }
    });

    after(async () => {
      await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
    });

    test("POST /issues.json with various custom field types (custom_fields format)", async () => {
      const response = await client.POST("/issues.{format}", {
        params: { path: { format: "json" } },
        body: {
          issue: {
            project_id: projectId,
            tracker_id: 1,
            subject: "CF test - custom_fields format",
            custom_fields: [
              { id: cfIds["CF String"], value: "hello" },
              { id: cfIds["CF Text"], value: "multi\nline\ntext" },
              { id: cfIds["CF Int"], value: "42" },
              { id: cfIds["CF Float"], value: "3.14" },
              { id: cfIds["CF Date"], value: "2024-06-15" },
              { id: cfIds["CF Bool"], value: "1" },
              { id: cfIds["CF Link"], value: "https://example.com" },
              { id: cfIds["CF List"], value: "Alpha" },
              { id: cfIds["CF List Multi"], value: ["Red", "Blue"] },
              { id: cfIds["CF User"], value: "1" },
              { id: cfIds["CF Version"], value: String(versionId) },
            ],
          },
        },
      });
      assertStatus(201, response);
      issueId = response.data!.issue.id;

      // Verify custom fields in the response
      const cfs = response.data!.issue.custom_fields!;
      assert(cfs.length > 0, "Expected custom fields in response");

      const findCf = (name: string) => cfs.find((cf) => cf.name === name);

      // Single value fields return string
      assert.strictEqual(findCf("CF String")?.value, "hello");
      assert.strictEqual(findCf("CF Text")?.value, "multi\nline\ntext");
      assert.strictEqual(findCf("CF Int")?.value, "42");
      assert.strictEqual(findCf("CF Float")?.value, "3.14");
      assert.strictEqual(findCf("CF Date")?.value, "2024-06-15");
      assert.strictEqual(findCf("CF Bool")?.value, "1");
      assert.strictEqual(findCf("CF Link")?.value, "https://example.com");
      assert.strictEqual(findCf("CF List")?.value, "Alpha");

      // Multi-value field returns array
      const multiCf = findCf("CF List Multi");
      assert(multiCf, "Expected CF List Multi in response");
      assert.strictEqual(multiCf!.multiple, true);
      assert(Array.isArray(multiCf!.value), "Multi-value field should return array");
      const multiValue = multiCf!.value as string[];
      assert(multiValue.includes("Red"), "Expected 'Red' in multi-value");
      assert(multiValue.includes("Blue"), "Expected 'Blue' in multi-value");

      // User and version fields return ID as string
      assert.strictEqual(findCf("CF User")?.value, "1");
      assert.strictEqual(findCf("CF Version")?.value, String(versionId));
    });

    test("GET /issues/{issue_id}.json returns custom fields", async () => {
      const response = await client.GET("/issues/{issue_id}.{format}", {
        params: { path: { format: "json", issue_id: issueId } },
      });
      assertStatus(200, response);

      const cfs = response.data!.issue.custom_fields!;
      assert(cfs.length > 0, "Expected custom fields in response");

      const findCf = (name: string) => cfs.find((cf) => cf.name === name);
      assert.strictEqual(findCf("CF String")?.value, "hello");

      // Multi-value field should have multiple attribute and array value
      const multiCf = findCf("CF List Multi");
      assert.strictEqual(multiCf!.multiple, true);
      assert(Array.isArray(multiCf!.value), "Multi-value should be array");
    });

    test("PUT /issues/{issue_id}.json update custom fields (custom_field_values format)", async () => {
      const response = await client.PUT("/issues/{issue_id}.{format}", {
        params: { path: { format: "json", issue_id: issueId } },
        body: {
          issue: {
            custom_field_values: {
              [String(cfIds["CF String"])]: "updated",
              [String(cfIds["CF Int"])]: "99",
              [String(cfIds["CF Bool"])]: "0",
              [String(cfIds["CF List Multi"])]: ["Green"],
            },
          },
        },
      });
      assertStatus(204, response);

      // Verify updated values
      const getRes = await client.GET("/issues/{issue_id}.{format}", {
        params: { path: { format: "json", issue_id: issueId } },
      });
      assertStatus(200, getRes);

      const cfs = getRes.data!.issue.custom_fields!;
      const findCf = (name: string) => cfs.find((cf) => cf.name === name);
      assert.strictEqual(findCf("CF String")?.value, "updated");
      assert.strictEqual(findCf("CF Int")?.value, "99");
      assert.strictEqual(findCf("CF Bool")?.value, "0");

      const multiCf = findCf("CF List Multi");
      assert(Array.isArray(multiCf!.value), "Multi-value should be array");
      assert.deepStrictEqual(multiCf!.value, ["Green"]);
    });

    test("POST /issues.json with null/empty custom field values", async () => {
      const response = await client.POST("/issues.{format}", {
        params: { path: { format: "json" } },
        body: {
          issue: {
            project_id: projectId,
            tracker_id: 1,
            subject: "CF test - null values",
            custom_fields: [
              { id: cfIds["CF String"], value: null },
              { id: cfIds["CF List Multi"], value: [] },
            ],
          },
        },
      });
      assertStatus(201, response);

      const cfs = response.data!.issue.custom_fields!;
      const findCf = (name: string) => cfs.find((cf) => cf.name === name);

      // Null value should return null or empty string
      const strCf = findCf("CF String");
      assert(
        strCf!.value === null || strCf!.value === "",
        `Expected null or empty string, got: ${strCf!.value}`
      );

      // Empty multi-value should return empty array
      const multiCf = findCf("CF List Multi");
      assert(Array.isArray(multiCf!.value), "Multi-value should be array");
      assert.strictEqual(
        (multiCf!.value as string[]).length,
        0,
        "Expected empty array"
      );
    });
  });

  // Test custom fields in projects
  describe("Project custom fields", async () => {
    let projectId: number;
    let cfId: number;

    before(async () => {
      // Find CF Project String ID
      const cfRes = await client.GET("/custom_fields.{format}", {
        params: { path: { format: "json" } },
      });
      assertStatus(200, cfRes);
      const cf = cfRes.data!.custom_fields.find(
        (cf) => cf.name === "CF Project String"
      );
      assert(cf, "Expected CF Project String custom field");
      cfId = cf!.id;
    });

    after(async () => {
      if (projectId) {
        await client.DELETE("/projects/{project_id}.{format}", {
          params: { path: { format: "json", project_id: projectId } },
        });
      }
    });

    test("POST /projects.json with custom_fields", async () => {
      const projectName = `cf-proj-${Date.now()}`;
      const response = await client.POST("/projects.{format}", {
        params: { path: { format: "json" } },
        body: {
          project: {
            name: projectName,
            identifier: projectName,
            custom_fields: [{ id: cfId, value: "project-cf-value" }],
          },
        },
      });
      assertStatus(201, response);
      projectId = response.data!.project.id;

      const cfs = response.data!.project.custom_fields!;
      const cf = cfs.find((c) => c.name === "CF Project String");
      assert(cf, "Expected CF Project String in response");
      assert.strictEqual(cf!.value, "project-cf-value");
    });

    test("GET /projects/{project_id}.json returns custom fields", async () => {
      const response = await client.GET("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
      assertStatus(200, response);

      const cfs = response.data!.project.custom_fields!;
      const cf = cfs.find((c) => c.name === "CF Project String");
      assert(cf, "Expected CF Project String in response");
      assert.strictEqual(cf!.value, "project-cf-value");
    });
  });

  // Test custom fields in time entries
  describe("Time entry custom fields", async () => {
    let projectId: number;
    let issueId: number;
    let timeEntryId: number;
    let activityId: number;
    let cfId: number;

    before(async () => {
      // Find CF TimeEntry String ID
      const cfRes = await client.GET("/custom_fields.{format}", {
        params: { path: { format: "json" } },
      });
      assertStatus(200, cfRes);
      const cf = cfRes.data!.custom_fields.find(
        (cf) => cf.name === "CF TimeEntry String"
      );
      assert(cf, "Expected CF TimeEntry String custom field");
      cfId = cf!.id;

      // Create project and issue
      const projectName = `cf-time-${Date.now()}`;
      const projectRes = await client.POST("/projects.{format}", {
        params: { path: { format: "json" } },
        body: {
          project: {
            name: projectName,
            identifier: projectName,
            enabled_module_names: ["issue_tracking", "time_tracking"],
          },
        },
      });
      assertStatus(201, projectRes);
      projectId = projectRes.data!.project.id;

      const issueRes = await client.POST("/issues.{format}", {
        params: { path: { format: "json" } },
        body: {
          issue: { project_id: projectId, tracker_id: 1, subject: "time-cf-test" },
        },
      });
      assertStatus(201, issueRes);
      issueId = issueRes.data!.issue.id;

      const actRes = await client.GET(
        "/enumerations/time_entry_activities.{format}",
        { params: { path: { format: "json" } } }
      );
      assertStatus(200, actRes);
      activityId = actRes.data!.time_entry_activities[0].id;
    });

    after(async () => {
      await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
    });

    test("POST /time_entries.json with custom_fields", async () => {
      const response = await client.POST("/time_entries.{format}", {
        params: { path: { format: "json" } },
        body: {
          time_entry: {
            issue_id: issueId,
            hours: 1,
            activity_id: activityId,
            custom_fields: [{ id: cfId, value: "time-entry-cf" }],
          },
        },
      });
      assertStatus(201, response);
      timeEntryId = response.data!.time_entry.id;

      const cfs = response.data!.time_entry.custom_fields!;
      const cf = cfs.find((c) => c.name === "CF TimeEntry String");
      assert(cf, "Expected CF TimeEntry String in response");
      assert.strictEqual(cf!.value, "time-entry-cf");
    });

    test("GET /time_entries/{time_entry_id}.json returns custom fields", async () => {
      const response = await client.GET(
        "/time_entries/{time_entry_id}.{format}",
        {
          params: {
            path: { format: "json", time_entry_id: timeEntryId },
          },
        }
      );
      assertStatus(200, response);

      const cfs = response.data!.time_entry.custom_fields!;
      const cf = cfs.find((c) => c.name === "CF TimeEntry String");
      assert(cf, "Expected CF TimeEntry String in response");
      assert.strictEqual(cf!.value, "time-entry-cf");
    });
  });
});
