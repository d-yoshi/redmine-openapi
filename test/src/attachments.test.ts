import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

// Minimal 2x2 RGB PNG image
const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==",
  "base64"
);

describe("Attachments", () => {
  let projectId: number;
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
        query: { filename: "test.txt", content_type: "text/plain" },
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

    const getIssueResponse = await client.GET(
      "/issues/{issue_id}.{format}",
      {
        params: {
          path: { format: "json", issue_id: issueResponse.data!.issue.id },
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
    if (projectId) {
      await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
    }
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
          query: { size: 100 },
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

  test("GET /attachments/{attachment_id}.json for a thumbnailable attachment", async () => {
    const response = await client.GET(
      "/attachments/{attachment_id}.{format}",
      {
        params: {
          path: { format: "json", attachment_id: imageAttachmentId },
        },
      }
    );
    assertStatus(200, response);
    assert(
      response.data!.attachment.thumbnail_url,
      "Expected thumbnail_url for an image attachment"
    );
  });

  test("POST /uploads.json returns 406 for wrong content type", async () => {
    const response = await client.POST("/uploads.{format}", {
      params: {
        path: { format: "json" },
        query: { filename: "wrong-content-type.txt" },
      },
      body: "file content",
      bodySerializer: (body) => body,
      headers: { "Content-Type": "text/plain" },
    });
    assertStatus(406, response);
  });

  test("POST /uploads.json returns 422 for invalid data", async () => {
    // Attachment#filename is limited to 255 characters
    const response = await client.POST("/uploads.{format}", {
      params: {
        path: { format: "json" },
        query: { filename: `${"a".repeat(300)}.txt` },
      },
      body: "file content",
      bodySerializer: (body) => body,
      headers: { "Content-Type": "application/octet-stream" },
    });
    assertStatus(422, response);
  });

  test("GET /attachments/{attachment_id}.json returns 404", async () => {
    const response = await client.GET(
      "/attachments/{attachment_id}.{format}",
      {
        params: { path: { format: "json", attachment_id: 999999 } },
      }
    );
    assertStatus(404, response);
  });

  test("GET /attachments/download/{attachment_id}/{filename} returns 404", async () => {
    // The route pins the format to html, so the 404 body is always an
    // HTML error page (declared as binary content in the spec)
    const response = await client.GET(
      "/attachments/download/{attachment_id}/{filename}",
      {
        params: {
          path: { attachment_id: 999999, filename: "missing.txt" },
        },
        parseAs: "blob",
      }
    );
    assertStatus(404, response);
  });

  test("GET /attachments/thumbnail/{attachment_id} returns 404", async () => {
    const response = await client.GET(
      "/attachments/thumbnail/{attachment_id}",
      {
        params: { path: { attachment_id: 999999 } },
        headers: { Accept: "application/json" },
        parseAs: "blob",
      }
    );
    assertStatus(404, response);
  });

  test("PATCH /attachments/{attachment_id}.json returns 404", async () => {
    const response = await client.PATCH(
      "/attachments/{attachment_id}.{format}",
      {
        params: { path: { format: "json", attachment_id: 999999 } },
        body: { attachment: { filename: "missing.txt" } },
      }
    );
    assertStatus(404, response);
  });

  test("PATCH /attachments/{attachment_id}.json returns 422 for invalid data", async () => {
    const response = await client.PATCH(
      "/attachments/{attachment_id}.{format}",
      {
        params: { path: { format: "json", attachment_id: attachmentId } },
        body: { attachment: { filename: "" } },
      }
    );
    assertStatus(422, response);
  });

  test("DELETE /attachments/{attachment_id}.json returns 404", async () => {
    const response = await client.DELETE(
      "/attachments/{attachment_id}.{format}",
      {
        params: { path: { format: "json", attachment_id: 999999 } },
      }
    );
    assertStatus(404, response);
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
