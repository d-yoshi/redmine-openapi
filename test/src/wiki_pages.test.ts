import { test } from "node:test";

import { client, assertStatus } from "./helpers.js";

const uploadFile = async (filename: string, content: string) => {
  const response = await client.POST("/uploads.{format}", {
    params: {
      path: { format: "json" },
      query: { filename },
    },
    body: content,
    bodySerializer: (body) => body,
    headers: { "Content-Type": "application/octet-stream" },
  });
  assertStatus(201, response);
  return response.data!.upload;
};

test("Wiki Pages", async (t) => {
  const projectIdentifier = `wiki-${Date.now()}`;
  const projectResponse = await client.POST("/projects.{format}", {
    params: { path: { format: "json" } },
    body: {
      project: {
        name: projectIdentifier,
        identifier: projectIdentifier,
        enabled_module_names: ["wiki"],
      },
    },
  });
  assertStatus(201, projectResponse);
  const projectId = projectResponse.data!.project.id;

  await t.test("PUT /projects/{project_id}/wiki/{wiki_page_title}.json (create)", async () => {
    const upload = await uploadFile("wiki-attachment.txt", "file content");
    const response = await client.PUT(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "TestPage",
          },
        },
        body: {
          wiki_page: {
            text: "Wiki page content from API",
            comments: "Initial creation",
            uploads: [
              {
                token: upload.token,
                filename: "wiki-attachment.txt",
                description: "attachment",
                content_type: "text/plain",
              },
            ],
          },
        },
      }
    );
    assertStatus(201, response);
  });

  await t.test("PUT /projects/{project_id}/wiki/{wiki_page_title}.json (create with parent)", async () => {
    const response = await client.PUT(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "ChildPage",
          },
        },
        body: {
          wiki_page: {
            text: "Child page content",
            comments: "Child page creation",
            parent_title: "TestPage",
          },
        },
      }
    );
    assertStatus(201, response);
  });

  await t.test("PUT /projects/{project_id}/wiki/{wiki_page_title}.json (update)", async () => {
    const response = await client.PUT(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "TestPage",
          },
        },
        body: {
          wiki_page: {
            text: "Updated wiki page content",
            comments: "Updated via API",
          },
        },
      }
    );
    assertStatus(204, response);
  });

  await t.test("GET /projects/{project_id}/wiki/{wiki_page_title}.json with include=attachments", async () => {
    const response = await client.GET(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "TestPage",
          },
          query: {
            include: ["attachments"],
          },
        },
      }
    );
    assertStatus(200, response);
  });

  await t.test("GET /projects/{project_id}/wiki/{wiki_page_title}/{version_id}.json", async () => {
    const response = await client.GET(
      "/projects/{project_id}/wiki/{wiki_page_title}/{version_id}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "TestPage",
            version_id: 1,
          },
          query: {
            include: ["attachments"],
          },
        },
      }
    );
    assertStatus(200, response);
  });

  await t.test("PUT /projects/{project_id}/wiki/{wiki_page_title}.json returns 409 on version conflict", async () => {
    const response = await client.PUT(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "TestPage",
          },
        },
        body: {
          wiki_page: {
            text: "Conflict attempt",
            version: 1,
          },
        },
      }
    );
    assertStatus(409, response);
  });

  await t.test("GET /projects/{project_id}/wiki/index.json", async () => {
    const response = await client.GET(
      "/projects/{project_id}/wiki/index.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
          },
        },
      }
    );
    assertStatus(200, response);
  });

  await t.test("DELETE /projects/{project_id}/wiki/{wiki_page_title}.json", async () => {
    const response = await client.DELETE(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "ChildPage",
          },
        },
      }
    );
    assertStatus(204, response);
  });

  await client.DELETE("/projects/{project_id}.{format}", {
    params: { path: { format: "json", project_id: projectId } },
  });
});
