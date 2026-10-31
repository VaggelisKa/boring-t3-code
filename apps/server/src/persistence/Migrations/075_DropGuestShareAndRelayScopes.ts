import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Guest links are gone. Their thread events carry the whole thread, like metadata updates, so
  // they replay as such; the share itself, with the guests' names and waiting messages, is dropped.
  yield* sql`
    UPDATE orchestration_events
    SET event_type = 'thread.metadata-updated'
    WHERE aggregate_kind = 'thread' AND event_type = 'thread.guest-share-updated'
  `;
  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_remove(payload_json, '$.guestShare')
    WHERE aggregate_kind = 'thread' AND json_type(payload_json, '$.guestShare') IS NOT NULL
  `;
  yield* sql`
    UPDATE orchestration_v2_projection_threads
    SET payload_json = json_remove(payload_json, '$.guestShare')
    WHERE json_type(payload_json, '$.guestShare') IS NOT NULL
  `;

  // The relay scopes are no longer part of the scope vocabulary the server decodes.
  yield* sql`
    UPDATE auth_sessions
    SET scopes = (
      SELECT json_group_array(value) FROM json_each(auth_sessions.scopes)
      WHERE value NOT IN ('relay:read', 'relay:write')
    )
    WHERE EXISTS (
      SELECT 1 FROM json_each(auth_sessions.scopes) WHERE value IN ('relay:read', 'relay:write')
    )
  `;
  yield* sql`
    UPDATE auth_pairing_links
    SET scopes = (
      SELECT json_group_array(value) FROM json_each(auth_pairing_links.scopes)
      WHERE value NOT IN ('relay:read', 'relay:write')
    )
    WHERE EXISTS (
      SELECT 1 FROM json_each(auth_pairing_links.scopes) WHERE value IN ('relay:read', 'relay:write')
    )
  `;

  yield* sql`DROP TABLE IF EXISTS scheduled_task_webhook_relay_deliveries`;
});
