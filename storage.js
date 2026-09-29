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

    deleteSalesState,

    testTursoConnection

};