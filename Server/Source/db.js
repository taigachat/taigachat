import SqliteDB from "better-sqlite3";
import config from "./config.js";
import { existsSync, mkdirSync } from "fs";

if (!existsSync(config.dataPath)) {
    mkdirSync(config.dataPath);
}
export const db = new SqliteDB(`${config.dataPath}/server.sqlite3`);

// Title is synonyms with name. We avoid name because some dialects apparently reserve it.
const migrations = [
    `--sql 0
     CREATE TABLE rooms (
        room_id            INTEGER PRIMARY KEY AUTOINCREMENT,
        last_modified      BIGINT NOT NULL,
        faddishness        BIGINT NOT NULL,
        title              TEXT   DEFAULT 'unnamed-room' NOT NULL,
        description        TEXT   DEFAULT '' NOT NULL,
        encrypted_by       TEXT   DEFAULT '' NOT NULL,
        messages_per_chunk INT    DEFAULT 512 NOT NULL,
        next_message_index INT    DEFAULT 512 NOT NULL,
        chunk_count        BIGINT DEFAULT 0 NOT NULL
     );
     CREATE TABLE messages (
        last_modified BIGINT NOT NULL,
        faddishness   BIGINT NOT NULL,
        created       BIGINT NOT NULL,
        text          TEXT   NOT NULL,
        attachment    TEXT   NOT NULL,
        flags         INT    DEFAULT 0  NOT NULL,
        encrypted_by  TEXT   DEFAULT '' NOT NULL,
        author        TEXT   NOT NULL,
        room          INT    NOT NULL,
        chunk         BIGINT NOT NULL,
        message_index INT    NOT NULL,
        PRIMARY KEY (room, chunk, message_index)
     );
     CREATE TABLE permissions (
        role_id    INT  NOT NULL,
        subdomain  TEXT NOT NULL,
        allowed    BIGINT DEFAULT 0 NOT NULL,
        denied     BIGINT DEFAULT 0 NOT NULL,
        PRIMARY KEY (role_id, subdomain)
     );
     CREATE TABLE roles (
        role_id       INTEGER PRIMARY KEY AUTOINCREMENT,
        last_modified BIGINT NOT NULL,
        faddishness   BIGINT NOT NULL,
        penalty       INT    NOT NULL,
        title         TEXT DEFAULT 'unnamed-role' NOT NULL,
        flags         INT  DEFAULT 0 NOT NULL
     );
     CREATE TABLE users (
        user_id_num   INTEGER PRIMARY KEY AUTOINCREMENT,
        last_modified BIGINT NOT NULL,
        faddishness   BIGINT NOT NULL,
        user_id       TEXT   NOT NULL,
        auth_id       TEXT   UNIQUE NOT NULL,
        roles         TEXT   DEFAULT '[]' NOT NULL,
        last_seen     BIGINT NOT NULL,
        first_joined  BIGINT NOT NULL,
        public_identity    TEXT NOT NULL,
        prior_identities   TEXT DEFAULT '[]' NOT NULL,
        profile_timestamp  BIGINT DEFAULT 0 NOT NULL
     );
     CREATE UNIQUE INDEX users_by_user_id ON users (user_id);
     CREATE TABLE revoked_login (
        auth_id  TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        PRIMARY KEY (auth_id)
     );
     CREATE TABLE channels (
        channel_id    INTEGER PRIMARY KEY AUTOINCREMENT,
        last_modified BIGINT NOT NULL,
        faddishness   BIGINT NOT NULL,
        title         TEXT DEFAULT 'unnamed-channel' NOT NULL
     );
     CREATE TABLE notification_tokens (
        user_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        token TEXT NOT NULL,
        PRIMARY KEY (user_id, endpoint, token)
     );
     CREATE INDEX notification_tokens_by_user_id ON notification_tokens
        (user_id);
     CREATE INDEX notification_tokens_by_endpoint_token ON notification_tokens
        (endpoint, token);
     CREATE TABLE server_data ( -- All values must have a default here.
        public_salt TEXT DEFAULT '' NOT NULL
     );
     CREATE TABLE server_info (
        last_modified BIGINT DEFAULT 1 NOT NULL,
        faddishness   BIGINT DEFAULT 0 NOT NULL,
        name          TEXT NOT NULL
     );
     INSERT INTO server_info (name) values ('Unnamed');
    `,
];

/** For the flag in the roles table. A role having this flag will be automatically given to users that join. */
export const ROLE_DEFAULT_ROLE = 1;

/** For the flag in the roles table. A role having this flag will be automatically given to the first user that joins. */
export const ROLE_DEFAULT_ADMIN = 2;

export function runMigrations() {
    //db.pragma('foreign_keys = ON')
    db.pragma("journal_mode = WAL");
    const version = /** @type {number} */ (db.pragma("user_version", { simple: true }));
    console.log("schema version:", version);

    const update = db.transaction(function () {
        for (let i = version; i < migrations.length; i++) {
            db.exec(migrations[i] || "");
        }
        // Usually, this would be very stupid. Luckily migrations.length is always a number.
        db.pragma(`user_version = ${migrations.length}`);
    });
    update();
}
