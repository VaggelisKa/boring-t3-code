import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Review guides could only be written by the removed Codex and Claude providers.
  yield* sql`DROP TABLE IF EXISTS pull_request_review_guides`;
});
