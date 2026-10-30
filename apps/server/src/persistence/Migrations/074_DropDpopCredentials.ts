import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // DPoP sessions and proof-bound pairing links can no longer be presented, and the session
  // method is no longer a value the server decodes.
  yield* sql`DELETE FROM auth_sessions WHERE method = 'dpop-access-token'`;
  yield* sql`DELETE FROM auth_pairing_links WHERE proof_key_thumbprint IS NOT NULL`;
});
