import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

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
      const response = await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
      assertStatus(204, response);
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
    assert.strictEqual(response.data!.wiki_page.version, 1);
    assert.strictEqual(response.data!.wiki_page.text, "Wiki page content from API");
    assert.strictEqual(response.data!.wiki_page.comments, "Initial creation");
    assert(!Object.hasOwn(response.data!.wiki_page, "parent"));
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
    assert.deepStrictEqual(response.data!.wiki_page.parent, { title: "TestPage" });
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

    const wikiPage = response.data!.wiki_page;
    assert.strictEqual(wikiPage.version, 2);
    assert.strictEqual(wikiPage.text, "Updated wiki page content");
    assert.strictEqual(wikiPage.comments, "Updated via API");
    assert(wikiPage.attachments?.some((attachment) => attachment.filename === "wiki-attachment.txt"));
    assert(wikiPage.project, "Expected wiki page to include its project");
    assert.strictEqual(typeof wikiPage.project!.id, "number");
    assert.strictEqual(typeof wikiPage.project!.name, "string");
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
    assert.strictEqual(response.data!.wiki_page.version, 1);
    assert.strictEqual(response.data!.wiki_page.text, "Wiki page content from API");
    assert.strictEqual(response.data!.wiki_page.comments, "Initial creation");
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

  test("PUT /projects/{project_id}/wiki/{wiki_page_title}.json (delete attachment)", async () => {
    const getResponse = await client.GET(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "TestPage",
          },
          query: { include: ["attachments"] },
        },
      }
    );
    assertStatus(200, getResponse);
    const attachmentId = getResponse.data!.wiki_page.attachments![0].id;

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
            deleted_attachment_ids: [attachmentId],
          },
        },
      }
    );
    assertStatus(204, response);

    const verifyResponse = await client.GET(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "TestPage",
          },
          query: { include: ["attachments"] },
        },
      }
    );
    assertStatus(200, verifyResponse);
    assert.strictEqual(
      verifyResponse.data!.wiki_page.attachments!.length,
      0,
      "Expected the attachment to be deleted"
    );
  });

  test("renaming without a redirect makes the old title return 404", async () => {
    const createResponse = await client.PUT(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "RenameSource",
          },
        },
        body: { wiki_page: { text: "Page to be renamed" } },
      }
    );
    assertStatus(201, createResponse);

    const renameResponse = await client.PUT(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "RenameSource",
          },
        },
        body: {
          wiki_page: {
            text: "Page to be renamed",
            title: "RenameTarget",
            redirect_existing_links: "0",
          },
        },
      }
    );
    assertStatus(204, renameResponse);

    const newTitleResponse = await client.GET(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "RenameTarget",
          },
        },
      }
    );
    assertStatus(200, newTitleResponse);
    assert.strictEqual(newTitleResponse.data!.wiki_page.title, "RenameTarget");

    const oldTitleResponse = await client.GET(
      "/projects/{project_id}/wiki/{wiki_page_title}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectIdentifier,
            wiki_page_title: "RenameSource",
          },
        },
      }
    );
    assertStatus(404, oldTitleResponse);
  });

  test("Wiki title redirects return 302 for reads and deletion without deleting the page", async () => {
    const path = {
      format: "json" as const,
      project_id: projectIdentifier,
      wiki_page_title: "RedirectSource",
    };
    const text = "Page retained behind an old-title redirect";
    const created = await client.PUT("/projects/{project_id}/wiki/{wiki_page_title}.{format}", {
      params: { path },
      body: { wiki_page: { text, is_start_page: true } },
    });
    assertStatus(201, created);
    const renamed = await client.PUT("/projects/{project_id}/wiki/{wiki_page_title}.{format}", {
      params: { path },
      body: {
        wiki_page: {
          text,
          title: "RedirectTarget",
          redirect_existing_links: "1",
          is_start_page: false,
        },
      },
    });
    assertStatus(204, renamed);

    const requests = [
      {
        request: () =>
          client.GET("/projects/{project_id}/wiki/{wiki_page_title}.{format}", {
            params: { path },
          }),
        suffix: "",
      },
      {
        request: () =>
          client.GET("/projects/{project_id}/wiki/{wiki_page_title}/{version_id}.{format}", {
            params: { path: { ...path, version_id: 1 } },
          }),
        suffix: "/1",
      },
      {
        request: () =>
          client.GET("/projects/{project_id}/wiki.{format}", {
            params: { path: { format: "json", project_id: projectIdentifier } },
          }),
        suffix: "",
      },
      {
        request: () =>
          client.DELETE("/projects/{project_id}/wiki/{wiki_page_title}.{format}", {
            params: { path },
          }),
        suffix: "",
      },
    ];
    for (const { request, suffix } of requests) {
      const result = await request();
      assertStatus(302, result);
      const location = result.response.headers.get("location");
      assert(location, "Expected a Location header on the Wiki redirect");
      assert.equal(
        new URL(location, result.response.url).pathname,
        `/projects/${projectIdentifier}/wiki/RedirectTarget${suffix}`
      );
    }
    const current = await client.GET("/projects/{project_id}/wiki/{wiki_page_title}.{format}", {
      params: { path: { ...path, wiki_page_title: "RedirectTarget" } },
    });
    assertStatus(200, current);
    assert.equal(current.data!.wiki_page.title, "RedirectTarget");
    assert.equal(current.data!.wiki_page.text, text);
  });

  test("PUT /projects/{project_id}/wiki/{wiki_page_title}.json (set start page)", async () => {
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
          wiki_page: { text: "Updated wiki page content", is_start_page: true },
        },
      }
    );
    assertStatus(204, response);
    const start = await client.GET("/projects/{project_id}/wiki.{format}", {
      params: {
        path: { format: "json", project_id: projectIdentifier },
        query: { include: ["attachments"] },
      },
    });
    assertStatus(200, start);
    assert.equal(start.data!.wiki_page.title, "TestPage");
    assert.equal(start.data!.wiki_page.text, "Updated wiki page content");
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

    const pages = response.data!.wiki_pages;
    assert(pages.length > 0, "Expected the created wiki pages to be listed");
    const child = pages.find((page) => page.title === "ChildPage");
    assert(child, "Expected the created child page in the wiki index");
    assert.deepStrictEqual(child.parent, { title: "TestPage" });
    for (const page of pages) {
      assert.deepStrictEqual(page.project, {
        id: projectId,
        name: projectIdentifier,
      });
    }
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

  test("the start-page route returns 404 for an unknown project", async () => {
    assertStatus(
      404,
      await client.GET("/projects/{project_id}/wiki.{format}", {
        params: { path: { format: "json", project_id: "missing-project" } },
      })
    );
  });

  test("the version query selects historical content", async () => {
    const result = await client.GET("/projects/{project_id}/wiki/{wiki_page_title}.{format}", {
      params: {
        path: { format: "json", project_id: projectIdentifier, wiki_page_title: "TestPage" },
        query: { version: 1 },
      },
    });
    assertStatus(200, result);
    assert.equal(result.data!.wiki_page.version, 1);
    const start = await client.GET("/projects/{project_id}/wiki.{format}", {
      params: { path: { format: "json", project_id: projectIdentifier }, query: { version: 1 } },
    });
    assertStatus(200, start);
    assert.equal(start.data!.wiki_page.version, 1);
  });

  test("unchanged wiki text does not conflict with a stale content version", async () => {
    const current = await client.GET("/projects/{project_id}/wiki/{wiki_page_title}.{format}", {
      params: {
        path: { format: "json", project_id: projectIdentifier, wiki_page_title: "TestPage" },
      },
    });
    assertStatus(200, current);
    const result = await client.PUT("/projects/{project_id}/wiki/{wiki_page_title}.{format}", {
      params: {
        path: { format: "json", project_id: projectIdentifier, wiki_page_title: "TestPage" },
      },
      body: { wiki_page: { text: current.data!.wiki_page.text, version: 0 } },
    });
    assertStatus(204, result);
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
  test("PATCH creates and updates Wiki content through the equivalent method", async () => {
    const params = {
      path: {
        format: "json" as const,
        project_id: projectIdentifier,
        wiki_page_title: "PatchPage",
      },
    };
    const created = await client.PATCH("/projects/{project_id}/wiki/{wiki_page_title}.{format}", {
      params,
      body: { wiki_page: { text: "Content created via PATCH" } },
    });
    assertStatus(201, created);
    assert.equal(created.data!.wiki_page.text, "Content created via PATCH");
    const updated = await client.PATCH("/projects/{project_id}/wiki/{wiki_page_title}.{format}", {
      params,
      body: { wiki_page: { text: "Content updated via PATCH" } },
    });
    assertStatus(204, updated);
    const current = await client.GET("/projects/{project_id}/wiki/{wiki_page_title}.{format}", {
      params,
    });
    assertStatus(200, current);
    assert.equal(current.data!.wiki_page.text, "Content updated via PATCH");
  });


});
