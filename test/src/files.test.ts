import { before, after, describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Files", async () => {
  let projectId: number;
  let projectIdentifier: string;

  let versionId: number;

  before(async () => {
    projectIdentifier = `file-${Date.now()}`;
    const projectResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name: projectIdentifier,
          identifier: projectIdentifier,
          enabled_module_names: [
            "issue_tracking",
            "files",
          ],
        },
      },
    });
    assertStatus(201, projectResponse);
    projectId = projectResponse.data!.project.id;

    const versionResponse = await client.POST(
      "/projects/{project_id}/versions.{format}",
      {
        params: { path: { format: "json", project_id: projectId } },
        body: { version: { name: "v1.0" } },
      }
    );
    assertStatus(201, versionResponse);
    versionId = versionResponse.data!.version.id;
  });

  after(async () => {
    await client.DELETE("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: projectId } },
    });
  });

  test("POST /projects/{project_id}/files.json", async () => {
    const uploadResponse = await client.POST("/uploads.{format}", {
      params: {
        path: { format: "json" },
        query: { filename: "project-file.txt" },
      },
      body: "file content" as any,
      bodySerializer: (body: any) => body,
      headers: { "Content-Type": "application/octet-stream" },
    });
    assertStatus(201, uploadResponse);
    const token = uploadResponse.data!.upload.token;

    const response = await client.POST(
      "/projects/{project_id}/files.{format}",
      {
        params: {
          path: { format: "json", project_id: projectIdentifier },
        },
        body: {
          file: {
            token,
            version_id: versionId,
            filename: "project-file.txt",
            description: "Test file",
            content_type: "text/plain",
          },
        },
      }
    );
    assertStatus(204, response);
  });

  test("GET /projects/{project_id}/files.json", async () => {
    const response = await client.GET(
      "/projects/{project_id}/files.{format}",
      {
        params: {
          path: { format: "json", project_id: projectIdentifier },
        },
      }
    );
    assertStatus(200, response);
  });
});
