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

test("News", async (t) => {
  const projectIdentifier = `news-${Date.now()}`;
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
  const projectId = projectResponse.data!.project.id;

  let newsId: number;

  await t.test("POST /projects/{project_id}/news.json", async () => {
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
    newsId = listResponse.data!.news[0].id;
  });

  await t.test("GET /news/{news_id}.json with all includes", async () => {
    const response = await client.GET("/news/{news_id}.{format}", {
      params: {
        path: { format: "json", news_id: newsId },
        query: {
          include: ["attachments", "comments"],
        },
      },
    });
    assertStatus(200, response);
  });

  await t.test("PUT /news/{news_id}.json", async () => {
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

  await t.test("GET /news.json with pagination", async () => {
    const response = await client.GET("/news.{format}", {
      params: {
        path: { format: "json" },
        query: { offset: 0, limit: 25 },
      },
    });
    assertStatus(200, response);
  });

  await t.test("GET /projects/{project_id}/news.json with pagination", async () => {
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

  await t.test("DELETE /news/{news_id}.json", async () => {
    const response = await client.DELETE("/news/{news_id}.{format}", {
      params: {
        path: { format: "json", news_id: newsId },
      },
    });
    assertStatus(204, response);
  });

  await client.DELETE("/projects/{project_id}.{format}", {
    params: { path: { format: "json", project_id: projectId } },
  });
});
