import type { operations } from "../dist/openapi-typescript/schema.d.ts";

type AddWatcherBody = NonNullable<operations["addWatcher"]["requestBody"]>["content"]["application/json"];
type AcceptsBody<Body> = Body extends AddWatcherBody ? true : false;
type AssertFalse<T extends false> = T;

export type WatcherBodyRejectsInvalidInputs = AssertFalse<
  | AcceptsBody<number>
  | AcceptsBody<{}>
  | AcceptsBody<{ user_id: string }>
  | AcceptsBody<{ watcher: { user_ids: string[] } }>
>;
