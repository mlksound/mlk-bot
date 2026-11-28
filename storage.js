'use strict';

const { createClient } = require('@libsql/client');

const TURSO_DATABASE_URL =
    (process.env.TURSO_DATABASE_URL || '').trim();

const TURSO_AUTH_TOKEN =
    (process.env.TURSO_AUTH_TOKEN || '').trim();

let turso = null;
let schemaReadyPromise = null;


// ============================================================
// TURSO CLIENT
// ============================================================

function getTursoClient() {

    if (!TURSO_DATABASE_URL) {
        throw new Error(
            'TURSO_DATABASE_URL missing'
        );
    }

    if (!TURSO_AUTH_TOKEN) {
        throw new Error(
            'TURSO_AUTH_TOKEN missing'
        );
    }

    if (!turso) {

        turso = createClient({
            url: TURSO_DATABASE_URL,
            authToken: TURSO_AUTH_TOKEN
        });
    }

    return turso;
}


// ============================================================
// DATABASE SCHEMA
// ============================================================

async function initStorage() {

    if (!schemaReadyPromise) {

        schemaReadyPromise =
            (async () => {

                const db =
                    getTursoClient();

                await db.execute(`
                    CREATE TABLE IF NOT EXISTS sales_states (
                        client_id TEXT PRIMARY KEY,
                        state_json TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                `);

                // Отдельное постоянное хранилище OAuth Bitrix.
                // id всегда равен 1: в приложении подключён один портал.
                await db.execute(`
                    CREATE TABLE IF NOT EXISTS bitrix_oauth (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        auth_json TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                `);

                // Telegram Business connection lifecycle and client routing.
                await db.execute(`
                    CREATE TABLE IF NOT EXISTS telegram_business_connections (
                        connection_id TEXT PRIMARY KEY,
                        connection_json TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                `);

                await db.execute(`
                    CREATE TABLE IF NOT EXISTS telegram_business_routes (
                        client_id TEXT PRIMARY KEY,
                        connection_id TEXT NOT NULL,
                        chat_id TEXT NOT NULL,
                        route_json TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                `);

                await db.execute(`
                    CREATE TABLE IF NOT EXISTS client_modes (
                        client_id TEXT PRIMARY KEY,
                        mode TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                `);

                // Полный архив сообщений хранится отдельно от sales_states.
                // Он не обрезается вместе с оперативной историей Sales Engine.
                await db.execute(`
                    CREATE TABLE IF NOT EXISTS client_messages (
                        message_id TEXT PRIMARY KEY,
                        client_id TEXT NOT NULL,
                        role TEXT NOT NULL,
                        sender TEXT,
                        source TEXT,
                        content TEXT NOT NULL,
                        timestamp TEXT NOT NULL,
                        meta_json TEXT NOT NULL
                    )
                `);

                await db.execute(`
                    CREATE INDEX IF NOT EXISTS idx_client_messages_client_time
                    ON client_messages (client_id, timestamp)
                `);

            })();
    }

    await schemaReadyPromise;
}


// ============================================================
// LOAD SALES STATE
// ============================================================

async function loadSalesState(
    clientId
) {

    await initStorage();

    const db =
        getTursoClient();

    const result =
        await db.execute({
            sql: `
                SELECT state_json
                FROM sales_states
                WHERE client_id = ?
                LIMIT 1
            `,
            args: [
                String(clientId || '')
            ]
        });

    if (
        !result.rows ||
        result.rows.length === 0
    ) {
        return null;
    }

    const raw =
        result.rows[0].state_json;

    try {

        return JSON.parse(
            String(raw)
        );

    } catch (error) {

        throw new Error(
            `Invalid saved Sales State for client ${clientId}: ${error.message}`
        );
    }
}


// ============================================================
// SAVE SALES STATE
// ============================================================

async function saveSalesState(
    state
) {

    if (
        !state ||
        !state.client ||
        !state.client.id
    ) {
        throw new Error(
            'Cannot save Sales State without client.id'
        );
    }

    await initStorage();

    const db =
        getTursoClient();

    const updatedAt =
        state.updatedAt ||
        new Date().toISOString();

    state.updatedAt =
        updatedAt;

    await db.execute({
        sql: `
            INSERT INTO sales_states (
                client_id,
                state_json,
                updated_at
            )
            VALUES (?, ?, ?)
            ON CONFLICT(client_id)
            DO UPDATE SET
                state_json = excluded.state_json,
                updated_at = excluded.updated_at
        `,
        args: [
            String(state.client.id),
            JSON.stringify(state),
            updatedAt
        ]
    });

    return true;
}


// ============================================================
// APPEND FULL CLIENT MESSAGE HISTORY
// ============================================================

async function saveClientMessages(clientId, messages) {

    const key = String(clientId || '').trim();
    if (!key || !Array.isArray(messages) || messages.length === 0) {
        return true;
    }

    await initStorage();

    const db = getTursoClient();
    const statements = [];

    for (const message of messages) {
        if (!message || !message.content) continue;

        const role = message.role === 'user' ? 'user' : 'assistant';
        const timestamp = String(message.timestamp || new Date().toISOString());
        const sender = String(
            message.sender || (role === 'user' ? 'client' : 'dmitry')
        );
        const source = String(message.source || 'sales_engine');
        const content = String(message.content);
        const metaJson = JSON.stringify(message);

        // Стабильный ключ не требует менять структуру state.history.
        // Поэтому текущий контекст DeepSeek и логика Sales Engine не меняются.
        const messageId = require('crypto')
            .createHash('sha256')
            .update([key, timestamp, role, sender, source, content].join('\u001f'))
            .digest('hex');

        statements.push({
            sql: `
                INSERT OR IGNORE INTO client_messages (
                    message_id, client_id, role, sender, source,
                    content, timestamp, meta_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
                messageId, key, role, sender, source,
                content, timestamp, metaJson
            ]
        });
    }

    if (statements.length > 0) {
        await db.batch(statements, 'write');
    }

    return true;
}


// ============================================================
// DELETE SALES STATE
// ============================================================

async function deleteSalesState(
    clientId
) {

    await initStorage();

    const db =
        getTursoClient();

    await db.execute({
        sql: `
            DELETE FROM sales_states
            WHERE client_id = ?
        `,
        args: [
            String(clientId || '')
        ]
    });

    return true;
}


// ============================================================
// BITRIX OAUTH STORAGE
// ============================================================

async function loadBitrixAuth() {

    await initStorage();

    const db = getTursoClient();

    const result = await db.execute({
        sql: `
            SELECT auth_json
            FROM bitrix_oauth
            WHERE id = 1
            LIMIT 1
        `
    });

    if (!result.rows || result.rows.length === 0) {
        return null;
    }

    let auth;

    try {
        auth = JSON.parse(String(result.rows[0].auth_json));
    } catch (error) {
        throw new Error(`Invalid saved Bitrix OAuth data: ${error.message}`);
    }

    if (!auth || !auth.access_token || !auth.refresh_token) {
        throw new Error('Saved Bitrix OAuth data is incomplete');
    }

    return auth;
}


async function saveBitrixAuth(auth) {

    if (!auth || !auth.access_token || !auth.refresh_token) {
        throw new Error('Cannot save incomplete Bitrix OAuth data');
    }

    await initStorage();

    const db = getTursoClient();
    const updatedAt = new Date().toISOString();

    await db.execute({
        sql: `
            INSERT INTO bitrix_oauth (id, auth_json, updated_at)
            VALUES (1, ?, ?)
            ON CONFLICT(id)
            DO UPDATE SET
                auth_json = excluded.auth_json,
                updated_at = excluded.updated_at
        `,
        args: [JSON.stringify(auth), updatedAt]
    });

    return true;
}


// ============================================================
// TELEGRAM BUSINESS STORAGE
// ============================================================

async function saveTelegramBusinessConnection(connection) {

    if (!connection?.id) {
        throw new Error('Cannot save Telegram Business connection without id');
    }

    await initStorage();
    const db = getTursoClient();
    const updatedAt = new Date().toISOString();

    await db.execute({
        sql: `
            INSERT INTO telegram_business_connections (
                connection_id, connection_json, updated_at
            ) VALUES (?, ?, ?)
            ON CONFLICT(connection_id)
            DO UPDATE SET
                connection_json = excluded.connection_json,
                updated_at = excluded.updated_at
        `,
        args: [String(connection.id), JSON.stringify(connection), updatedAt]
    });

    return true;
}

async function loadTelegramBusinessConnections() {

    await initStorage();
    const db = getTursoClient();
    const result = await db.execute(`
        SELECT connection_json
        FROM telegram_business_connections
    `);

    return (result.rows || []).map(row => {
        try { return JSON.parse(String(row.connection_json)); }
        catch (error) {
            throw new Error(`Invalid Telegram Business connection JSON: ${error.message}`);
        }
    });
}

async function saveTelegramBusinessRoute(route) {

    if (!route?.clientId || !route?.connectionId || !route?.chatId) {
        throw new Error('Cannot save incomplete Telegram Business route');
    }

    await initStorage();
    const db = getTursoClient();
    const updatedAt = route.updatedAt || new Date().toISOString();
    route.updatedAt = updatedAt;

    await db.execute({
        sql: `
            INSERT INTO telegram_business_routes (
                client_id, connection_id, chat_id, route_json, updated_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(client_id)
            DO UPDATE SET
                connection_id = excluded.connection_id,
                chat_id = excluded.chat_id,
                route_json = excluded.route_json,
                updated_at = excluded.updated_at
        `,
        args: [
            String(route.clientId),
            String(route.connectionId),
            String(route.chatId),
            JSON.stringify(route),
            updatedAt
        ]
    });

    return true;
}

async function loadTelegramBusinessRoutes() {

    await initStorage();
    const db = getTursoClient();
    const result = await db.execute(`
        SELECT route_json
        FROM telegram_business_routes
    `);

    return (result.rows || []).map(row => {
        try { return JSON.parse(String(row.route_json)); }
        catch (error) {
            throw new Error(`Invalid Telegram Business route JSON: ${error.message}`);
        }
    });
}


async function saveClientMode(clientId, mode) {

    const key = String(clientId || '').trim();
    const normalizedMode = mode === 'MANAGER' ? 'MANAGER' : 'AI';

    if (!key) {
        throw new Error('Cannot save client mode without clientId');
    }

    await initStorage();
    const db = getTursoClient();
    const updatedAt = new Date().toISOString();

    await db.execute({
        sql: `
            INSERT INTO client_modes (client_id, mode, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(client_id)
            DO UPDATE SET
                mode = excluded.mode,
                updated_at = excluded.updated_at
        `,
        args: [key, normalizedMode, updatedAt]
    });

    return true;
}

async function loadClientModes() {

    await initStorage();
    const db = getTursoClient();
    const result = await db.execute(`
        SELECT client_id, mode
        FROM client_modes
    `);

    return (result.rows || []).map(row => ({
        clientId: String(row.client_id),
        mode: row.mode === 'MANAGER' ? 'MANAGER' : 'AI'
    }));
}


// ============================================================
// CONNECTION TEST
// ============================================================

async function testTursoConnection() {

    const db =
        getTursoClient();

    const result =
        await db.execute(
            'SELECT 1 AS ok'
        );

    const ok =
        Number(
            result?.rows?.[0]?.ok
        ) === 1;

    if (!ok) {

        throw new Error(
            'Turso test query returned unexpected result'
        );
    }

    return true;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    getTursoClient,

    initStorage,

    loadSalesState,

    saveSalesState,

    saveClientMessages,

    deleteSalesState,

    loadBitrixAuth,

    saveBitrixAuth,

    loadTelegramBusinessConnections,
    saveTelegramBusinessConnection,
    loadTelegramBusinessRoutes,
    saveTelegramBusinessRoute,

    loadClientModes,
    saveClientMode,

    testTursoConnection

};