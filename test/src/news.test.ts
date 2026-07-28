import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus, uploadFile } from "./helpers.js";

describe("News", () => {
  const projectIdentifier = `news-${Date.now()}`;
  let projectId: number;
  let newsId: number;

  before(async () => {
    const projectResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name: projectIdentifier,
          identifier: projectIdentifier,
          enabled_module_names: ["news"],
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

  test("POST /projects/{project_id}/news.json", async () => {
    const upload = await uploadFile("news-attachment.txt", "file content");
    const response = await client.POST(
      "/projects/{project_id}/news.{format}",
      {
        params: {
          path: { format: "json", project_id: projectIdentifier },
        },
        body: {
          news: {
            title: "news-1",
            summary: "summary-1",
            description: "description-1",
            uploads: [
              {
                token: upload.token,
                filename: "news-attachment.txt",
                description: "attachment",
                content_type: "text/plain",
              },
            ],
          },
        },
      }
    );
    assertStatus(204, response);

    const listResponse = await client.GET(
      "/projects/{project_id}/news.{format}",
      {
        params: {
          path: { format: "json", project_id: projectIdentifier },
        },
      }
    );
    assertStatus(200, listResponse);
    const news = listResponse.data!.news[0];
    assert(news, "Expected the created news entry in the project's list");
    newsId = news.id;
  });

  test("GET /news/{news_id}.json with all includes", async () => {
    const response = await client.GET("/news/{news_id}.{format}", {
      params: {
        path: { format: "json", news_id: newsId },
        query: {
          // `comments` is always empty and is not asserted below: news comments
          // cannot be created through the API at all (comments_controller has no
          // accept_api_auth), so that schema has no real data to validate against
          include: ["attachments", "comments"],
        },
      },
    });
    assertStatus(200, response);
    assert.strictEqual(
      response.data!.news.attachments?.length,
      1,
      "Expected the uploaded attachment in include=attachments"
    );
  });

  test("PUT /news/{news_id}.json", async () => {
    const upload = await uploadFile("news-update-attachment.txt", "updated");
    const response = await client.PUT("/news/{news_id}.{format}", {
      params: {
        path: { format: "json", news_id: newsId },
      },
      body: {
        news: {
          title: "news-1-updated",
          summary: "summary-1-updated",
          description: "description-1-updated",
          uploads: [
            {
              token: upload.token,
              filename: "news-update-attachment.txt",
              description: "update attachment",
              content_type: "text/plain",
            },
          ],
        },
      },
    });
    assertStatus(204, response);
  });

  test("GET /news.json with pagination", async () => {
    const response = await client.GET("/news.{format}", {
      params: {
        path: { format: "json" },
        query: { offset: 0, limit: 25 },
      },
    });
    assertStatus(200, response);
  });

  test("GET /projects/{project_id}/news.json with pagination", async () => {
    const response = await client.GET(
      "/projects/{project_id}/news.{format}",
      {
        params: {
          path: { format: "json", project_id: projectIdentifier },
          query: { offset: 0, limit: 25 },
        },
      }
    );
    assertStatus(200, response);
  });

  test("POST /projects/{project_id}/news.json returns 404 for nonexistent project", async () => {
    const response = await client.POST(
      "/projects/{project_id}/news.{format}",
      {
        params: { path: { format: "json", project_id: "nonexistent-project" } },
        body: { news: { title: "missing", description: "missing" } },
      }
    );
    assertStatus(404, response);
  });

  test("POST /projects/{project_id}/news.json returns 422 for invalid data", async () => {
    const response = await client.POST(
      "/projects/{project_id}/news.{format}",
      {
        params: { path: { format: "json", project_id: projectIdentifier } },
        body: { news: { title: "", description: "no title" } },
      }
    );
    assertStatus(422, response);
  });

  test("GET /projects/{project_id}/news.json returns 404 for nonexistent project", async () => {
    const response = await client.GET(
      "/projects/{project_id}/news.{format}",
      {
        params: { path: { format: "json", project_id: "nonexistent-project" } },
      }
    );
    assertStatus(404, response);
  });

  test("GET /news/{news_id}.json returns 404", async () => {
    const response = await client.GET("/news/{news_id}.{format}", {
      params: { path: { format: "json", news_id: 999999 } },
    });
    assertStatus(404, response);
  });

  test("PUT /news/{news_id}.json returns 404", async () => {
    const response = await client.PUT("/news/{news_id}.{format}", {
      params: { path: { format: "json", news_id: 999999 } },
      body: { news: { title: "missing" } },
    });
    assertStatus(404, response);
  });

  test("PUT /news/{news_id}.json returns 422 for invalid data", async () => {
    const response = await client.PUT("/news/{news_id}.{format}", {
      params: { path: { format: "json", news_id: newsId } },
      body: { news: { title: "" } },
    });
    assertStatus(422, response);
  });

  test("DELETE /news/{news_id}.json returns 404", async () => {
    const response = await client.DELETE("/news/{news_id}.{format}", {
      params: { path: { format: "json", news_id: 999999 } },
    });
    assertStatus(404, response);
  });

  test("DELETE /news/{news_id}.json", async () => {
    const response = await client.DELETE("/news/{news_id}.{format}", {
      params: {
        path: { format: "json", news_id: newsId },
      },
    });
    assertStatus(204, response);
  });
});
