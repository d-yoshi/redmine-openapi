import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==",
  "base64"
);
const MINIMAL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAACAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==",
  "base64"
);

describe("Attachments", () => {
  let projectId: number;
  let attachmentId: number;
  let imageAttachmentId: number;
  let jpegAttachmentId: number;
  let customTypeAttachmentId: number;

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

    const imageUploads: { token: string; filename: string; content_type: string }[] = [];
    for (const image of [
      { filename: "test.png", contentType: "image/png", bytes: MINIMAL_PNG },
      { filename: "test.jpg", contentType: "image/jpeg", bytes: MINIMAL_JPEG },
      { filename: "custom-type.png", contentType: "text/plain", bytes: MINIMAL_PNG },
    ]) {
      const response = await client.POST("/uploads.{format}", {
        params: {
          path: { format: "json" },
          query: { filename: image.filename },
        },
        // The generated body type is string; fetch accepts a Buffer at runtime.
        body: image.bytes as unknown as string,
        bodySerializer: (body) => body,
        headers: { "Content-Type": "application/octet-stream" },
      });
      assertStatus(201, response);
      imageUploads.push({
        token: response.data!.upload.token,
        filename: image.filename,
        content_type: image.contentType,
      });
    }

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
            ...imageUploads,
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
    jpegAttachmentId = attachments.find((a) => a.filename === "test.jpg")!.id;
    customTypeAttachmentId = attachments.find((a) => a.filename === "custom-type.png")!.id;
  });

  after(async () => {
    if (projectId) {
      const response = await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
      assertStatus(204, response);
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

  test("GET /attachments/thumbnail/{attachment_id} returns image/png for a PNG attachment", async () => {
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
    assert.strictEqual(response.response.headers.get("content-type")?.split(";")[0], "image/png");
  });

  test("GET /attachments/thumbnail/{attachment_id} returns image/jpeg for a JPEG attachment", async () => {
    const response = await client.GET("/attachments/thumbnail/{attachment_id}", {
      params: { path: { attachment_id: jpegAttachmentId } },
      parseAs: "blob",
    });
    assertStatus(200, response);
    assert.strictEqual(response.response.headers.get("content-type")?.split(";")[0], "image/jpeg");
  });

  test("GET /attachments/thumbnail/{attachment_id} preserves text/plain from the attachment's content_type", async () => {
    const response = await client.GET("/attachments/thumbnail/{attachment_id}", {
      params: { path: { attachment_id: customTypeAttachmentId } },
      parseAs: "blob",
    });
    assertStatus(200, response);
    assert.strictEqual(response.response.headers.get("content-type")?.split(";")[0], "text/plain");
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
            content_type: "text/markdown",
          },
        },
      }
    );
    assertStatus(204, response);

    const getResponse = await client.GET(
      "/attachments/{attachment_id}.{format}",
      {
        params: { path: { format: "json", attachment_id: attachmentId } },
      }
    );
    assertStatus(200, getResponse);
    const attachment = getResponse.data!.attachment;
    assert.strictEqual(attachment.filename, "renamed.txt");
    assert.strictEqual(attachment.description, "updated description");
    assert.strictEqual(attachment.content_type, "text/markdown");
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
    // Redmine rejects filenames longer than 255 characters.
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
    // This endpoint returns an HTML error page for a missing attachment.
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
