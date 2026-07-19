import { before, after, describe, test } from "node:test";

import { client, assertStatus, uploadFile } from "./helpers.js";

describe("Wiki Pages", () => {
  const projectIdentifier = `wiki-${Date.now()}`;
  let projectId: number;

  before(async () => {
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
    projectId = projectResponse.data!.project.id;
  });

  after(async () => {
    if (projectId) {
      await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
    }
  });

  test("PUT /projects/{project_id}/wiki/{wiki_page_title}.json (create)", async () => {
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

  test("PUT /projects/{project_id}/wiki/{wiki_page_title}.json (create with parent)", async () => {
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

  test("PUT /projects/{project_id}/wiki/{wiki_page_title}.json (update)", async () => {
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

  test("GET /projects/{project_id}/wiki/{wiki_page_title}.json with include=attachments", async () => {
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

  test("GET /projects/{project_id}/wiki/{wiki_page_title}/{version_id}.json", async () => {
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

  test("PUT /projects/{project_id}/wiki/{wiki_page_title}.json returns 409 on version conflict", async () => {
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

  test("GET /projects/{project_id}/wiki/index.json", async () => {
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

  test("GET /projects/{project_id}/wiki/index.json returns 404 for nonexistent project", async () => {
    const response = await client.GET(
      "/projects/{project_id}/wiki/index.{format}",
      {
        params: { path: { format: "json", project_id: "nonexistent-project" } },
      }
    );
    assertStatus(404, response);
  });

  test("GET /projects/{project_id}/wiki/{wiki_page_title}.json returns 404 for nonexistent page", async () => {
    const response = await client.GET(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "NoSuchPage",
          },
        },
      }
    );
    assertStatus(404, response);
  });

  test("GET /projects/{project_id}/wiki/{wiki_page_title}/{version_id}.json returns 404 for nonexistent version", async () => {
    const response = await client.GET(
      "/projects/{project_id}/wiki/{wiki_page_title}/{version_id}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "TestPage",
            version_id: 999,
          },
        },
      }
    );
    assertStatus(404, response);
  });

  test("PUT /projects/{project_id}/wiki/{wiki_page_title}.json returns 404 for nonexistent project", async () => {
    const response = await client.PUT(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: "nonexistent-project",
            wiki_page_title: "TestPage",
          },
        },
        body: { wiki_page: { text: "missing" } },
      }
    );
    assertStatus(404, response);
  });

  test("PUT /projects/{project_id}/wiki/{wiki_page_title}.json returns 422 for invalid data", async () => {
    // A nonexistent parent page fails the WikiPage parent validation.
    // Note: omitting text does NOT return 422 — Redmine 6.1 skips the
    // content save entirely and creates a broken content-less page (201)
    const response = await client.PUT(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "InvalidPage",
          },
        },
        body: {
          wiki_page: { text: "content", parent_title: "NoSuchParent" },
        },
      }
    );
    assertStatus(422, response);
  });

  test("DELETE /projects/{project_id}/wiki/{wiki_page_title}.json returns 404 for nonexistent page", async () => {
    const response = await client.DELETE(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "NoSuchPage",
          },
        },
      }
    );
    assertStatus(404, response);
  });

  test("DELETE /projects/{project_id}/wiki/{wiki_page_title}.json", async () => {
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
});
