import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("075_DropGuestShareAndRelayScopes", (it) => {
  it.effect("rewrites guest-share history and drops relay scopes, keeping the rest", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 74 });
      const share = '{"id":"share-1","messages":[{"id":"guest-message-1","status":"pending"}]}';
      const event = (eventId: string, eventType: string, payload: string, version: number) => ({
        event_id: eventId,
        aggregate_kind: "thread",
        stream_id: "thread-1",
        stream_version: version,
        event_type: eventType,
        occurred_at: "2026-10-01T00:00:00.000Z",
        actor_kind: "user",
        payload_json: payload,
        metadata_json: "{}",
      });
      yield* sql`INSERT INTO orchestration_events ${sql.insert([
        event(
          "event-share",
          "thread.guest-share-updated",
          `{"title":"Shared","guestShare":${share}}`,
          1,
        ),
        event("event-closed", "thread.metadata-updated", '{"title":"Closed","guestShare":null}', 2),
        event("event-plain", "thread.metadata-updated", '{"title":"Plain"}', 3),
      ])}`;
      yield* sql`INSERT INTO orchestration_v2_projection_threads ${sql.insert([
        {
          thread_id: "thread-1",
          project_id: "project-1",
          title: "Shared",
          default_provider: "codex",
          runtime_mode: "full-access",
          interaction_mode: "default",
          created_at: "2026-10-01T00:00:00.000Z",
          updated_at: "2026-10-01T00:00:00.000Z",
          payload_json: `{"title":"Shared","guestShare":${share}}`,
        },
      ])}`;
      yield* sql`INSERT INTO auth_sessions ${sql.insert([
        {
          session_id: "relay",
          subject: "paired-client",
          scopes: '["orchestration:read","relay:read","relay:write"]',
          method: "bearer-access-token",
          issued_at: "2026-10-01T00:00:00.000Z",
          expires_at: "2099-01-01T00:00:00.000Z",
        },
        {
          session_id: "plain",
          subject: "paired-client",
          scopes: '["orchestration:read","access:write"]',
          method: "bearer-access-token",
          issued_at: "2026-10-01T00:00:00.000Z",
          expires_at: "2099-01-01T00:00:00.000Z",
        },
      ])}`;
      yield* sql`INSERT INTO auth_pairing_links ${sql.insert([
        {
          id: "link",
          credential: "credential-link",
          method: "one-time-token",
          scopes: '["relay:write","orchestration:operate"]',
          subject: "one-time-token",
          created_at: "2026-10-01T00:00:00.000Z",
          expires_at: "2099-01-01T00:00:00.000Z",
        },
      ])}`;

      yield* runMigrations({ toMigrationInclusive: 75 });

      const events = yield* sql<{ event_id: string; event_type: string; payload_json: string }>`
        SELECT event_id, event_type, payload_json FROM orchestration_events ORDER BY sequence
      `;
      assert.deepEqual(events, [
        {
          event_id: "event-share",
          event_type: "thread.metadata-updated",
          payload_json: '{"title":"Shared"}',
        },
        {
          event_id: "event-closed",
          event_type: "thread.metadata-updated",
          payload_json: '{"title":"Closed"}',
        },
        {
          event_id: "event-plain",
          event_type: "thread.metadata-updated",
          payload_json: '{"title":"Plain"}',
        },
      ]);
      const threads = yield* sql<{ payload_json: string }>`
        SELECT payload_json FROM orchestration_v2_projection_threads
      `;
      assert.deepEqual(threads, [{ payload_json: '{"title":"Shared"}' }]);
      const sessions = yield* sql<{ session_id: string; scopes: string }>`
        SELECT session_id, scopes FROM auth_sessions ORDER BY session_id
      `;
      assert.deepEqual(sessions, [
        { session_id: "plain", scopes: '["orchestration:read","access:write"]' },
      ]);
      const links = yield* sql<{ scopes: string }>`SELECT scopes FROM auth_pairing_links`;
      assert.deepEqual(links, [{ scopes: '["orchestration:operate"]' }]);
      const tables = yield* sql<{ name: string }>`
        SELECT name FROM sqlite_master WHERE name = 'scheduled_task_webhook_relay_deliveries'
      `;
      assert.deepEqual(tables, []);
    }),
  );
});
