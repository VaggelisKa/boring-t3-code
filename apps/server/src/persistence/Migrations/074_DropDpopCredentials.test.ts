import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("074_DropDpopCredentials", (it) => {
  it.effect("drops DPoP sessions and proof-bound pairing links, keeping the rest", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 73 });
      const session = (sessionId: string, method: string) => ({
        session_id: sessionId,
        subject: "paired-client",
        scopes: '["orchestration:read"]',
        method,
        issued_at: "2026-10-01T00:00:00.000Z",
        expires_at: "2099-01-01T00:00:00.000Z",
      });
      yield* sql`INSERT INTO auth_sessions ${sql.insert([
        session("bearer", "bearer-access-token"),
        session("dpop", "dpop-access-token"),
      ])}`;
      const link = (id: string, proofKeyThumbprint: string | null) => ({
        id,
        credential: `credential-${id}`,
        method: "one-time-token",
        scopes: '["orchestration:read"]',
        subject: "one-time-token",
        proof_key_thumbprint: proofKeyThumbprint,
        created_at: "2026-10-01T00:00:00.000Z",
        expires_at: "2099-01-01T00:00:00.000Z",
      });
      yield* sql`INSERT INTO auth_pairing_links ${sql.insert([
        link("plain", null),
        link("bound", "thumbprint"),
      ])}`;

      yield* runMigrations({ toMigrationInclusive: 74 });

      const sessions = yield* sql<{ session_id: string }>`SELECT session_id FROM auth_sessions`;
      assert.deepEqual(sessions, [{ session_id: "bearer" }]);
      const links = yield* sql<{ id: string }>`SELECT id FROM auth_pairing_links`;
      assert.deepEqual(links, [{ id: "plain" }]);
    }),
  );
});
