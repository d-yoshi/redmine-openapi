import { before, after, describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

// Minimal 2x2 RGB PNG image
const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==",
  "base64"
);

describe("Attachments", async () => {
  let projectId: number;
  let issueId: number;
  let attachmentId: number;
  let imageAttachmentId: number;

  before(async () => {
    const projectIdentifier = `att-${Date.now()}`;
    const projectResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name: projectIdentifier,
          identifier: projectIdentifier,
        },
      },
    });
    assertStatus(201, projectResponse);
    projectId = projectResponse.data!.project.id;

    const uploadResponse = await client.POST("/uploads.{format}", {
      params: {
        path: { format: "json" },
        query: { filename: "test.txt" },
      },
      body: "file content",
      bodySerializer: (body) => body,
      headers: { "Content-Type": "application/octet-stream" },
    });
    assertStatus(201, uploadResponse);
    const token = uploadResponse.data!.upload.token;

    const pngUploadResponse = await client.POST("/uploads.{format}", {
      params: {
        path: { format: "json" },
        query: { filename: "test.png" },
      },
      body: MINIMAL_PNG as any,
      bodySerializer: (body: any) => body,
      headers: { "Content-Type": "application/octet-stream" },
    });
    assertStatus(201, pngUploadResponse);
    const pngToken = pngUploadResponse.data!.upload.token;

    const issueResponse = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectId,
          subject: "issue with attachment",
          uploads: [
            {
              token,
              filename: "test.txt",
              description: "test attachment",
              content_type: "text/plain",
            },
            {
              token: pngToken,
              filename: "test.png",
              description: "test image",
              content_type: "image/png",
            },
          ],
        },
      },
    });
    assertStatus(201, issueResponse);
    issueId = issueResponse.data!.issue.id;

    const getIssueResponse = await client.GET(
      "/issues/{issue_id}.{format}",
      {
        params: {
          path: { format: "json", issue_id: issueId },
          query: { include: ["attachments"] },
        },
      }
    );
    assertStatus(200, getIssueResponse);
    const attachments = getIssueResponse.data!.issue.attachments!;
    attachmentId = attachments.find((a) => a.filename === "test.txt")!.id;
    imageAttachmentId = attachments.find((a) => a.filename === "test.png")!.id;
  });

  after(async () => {
    await client.DELETE("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: projectId } },
    });
  });

  test("POST /uploads.json", async () => {
    const response = await client.POST("/uploads.{format}", {
      params: {
        path: { format: "json" },
        query: { filename: "another.txt" },
      },
      body: "another file",
      bodySerializer: (body) => body,
      headers: { "Content-Type": "application/octet-stream" },
    });
    assertStatus(201, response);
  });

  test("GET /attachments/{attachment_id}.json", async () => {
    const response = await client.GET(
      "/attachments/{attachment_id}.{format}",
      {
        params: {
          path: { format: "json", attachment_id: attachmentId },
        },
      }
    );
    assertStatus(200, response);
  });

  test("GET /attachments/download/{attachment_id}/{filename}", async () => {
    const response = await client.GET(
      "/attachments/download/{attachment_id}/{filename}",
      {
        params: {
          path: { attachment_id: attachmentId, filename: "test.txt" },
        },
        parseAs: "blob",
      }
    );
    assertStatus(200, response);
  });

  test("GET /attachments/thumbnail/{attachment_id}", async () => {
    const response = await client.GET(
      "/attachments/thumbnail/{attachment_id}",
      {
        params: {
          path: { attachment_id: imageAttachmentId },
        },
        parseAs: "blob",
      }
    );
    assertStatus(200, response);
  });

  test("PATCH /attachments/{attachment_id}.json", async () => {
    const response = await client.PATCH(
      "/attachments/{attachment_id}.{format}",
      {
        params: {
          path: { format: "json", attachment_id: attachmentId },
        },
        body: {
          attachment: {
            filename: "renamed.txt",
            description: "updated description",
            content_type: "text/plain",
          },
        },
      }
    );
    assertStatus(204, response);
  });

  test("DELETE /attachments/{attachment_id}.json", async () => {
    const response = await client.DELETE(
      "/attachments/{attachment_id}.{format}",
      {
        params: {
          path: { format: "json", attachment_id: attachmentId },
        },
      }
    );
    assertStatus(204, response);
  });
});
