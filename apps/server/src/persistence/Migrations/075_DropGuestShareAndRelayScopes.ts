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
  // Only events that carry the whole thread can hold the share; skip parsing the rest.
  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_remove(payload_json, '$.guestShare')
    WHERE aggregate_kind = 'thread'
      AND event_type IN (
        'thread.created', 'thread.archived', 'thread.unarchived', 'thread.deleted', 'thread.settled',
        'thread.unsettled', 'thread.snoozed', 'thread.unsnoozed', 'thread.pinned',
        'thread.unpinned', 'thread.pin-reordered', 'thread.active-reordered', 'thread.visited',
        'thread.marked-unread', 'thread.auto-settle-set', 'thread.metadata-updated',
        'thread.pull-request-synced', 'thread.runtime-mode-updated',
        'thread.interaction-mode-updated', 'thread.model-selection-updated',
        'thread.provider-switched'
      )
      AND json_type(payload_json, '$.guestShare') IS NOT NULL
  `;
  yield* sql`
    UPDATE orchestration_v2_projection_threads
    SET payload_json = json_remove(payload_json, '$.guestShare')
    WHERE json_type(payload_json, '$.guestShare') IS NOT NULL
  `;

  // Relay scopes left the vocabulary the server decodes. A session token signs its scopes, so a
  // session that holds one can no longer be presented and goes; a pairing link's scopes live only
  // in its row, so the link stays with the rest of them.
  yield* sql`
    DELETE FROM auth_sessions
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
