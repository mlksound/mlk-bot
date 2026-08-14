'use strict';

const express = require('express');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = Number(process.env.PORT || 10000);

const BITRIX_DOMAIN = String(
    process.env.BITRIX_DOMAIN || ''
).trim();

const CLIENT_ID = String(
    process.env.BITRIX_CLIENT_ID || ''
).trim();

const CLIENT_SECRET = String(
    process.env.BITRIX_CLIENT_SECRET || ''
).trim();

const PUBLIC_BASE_URL = String(
    process.env.PUBLIC_BASE_URL || ''
).trim().replace(/\/+$/, '');

const WEBHOOK_URL = String(
    process.env.BITRIX_WEBHOOK_URL || ''
).trim();

let oauthAuth = null;

function mask(value) {
    if (!value) {
        return 'MISSING';
    }

    const text = String(value);

    if (text.length <= 8) {
        return '********';
    }

    return text.slice(0, 4) + '...' + text.slice(-4);
}

function requireEnv() {
    const missing = [];

    if (!BITRIX_DOMAIN) {
        missing.push('BITRIX_DOMAIN');
    }

    if (!CLIENT_ID) {
        missing.push('BITRIX_CLIENT_ID');
    }

    if (!CLIENT_SECRET) {
        missing.push('BITRIX_CLIENT_SECRET');
    }

    if (!PUBLIC_BASE_URL) {
        missing.push('PUBLIC_BASE_URL');
    }

    if (missing.length > 0) {
        console.error('');
        console.error('========================================');
        console.error('❌ MISSING ENVIRONMENT VARIABLES');
        console.error('========================================');
        console.error(missing.join('\n'));
        console.error('========================================');
        console.error('');

        process.exit(1);
    }
}

function bitrixRestUrl() {
    return `https://${BITRIX_DOMAIN}/rest/`;
}

async function bitrixOAuthRequest(params) {
    const url =
        'https://oauth.bitrix.info/oauth/token/?' +
        new URLSearchParams(params).toString();

    console.log('');
    console.log('➡️ BITRIX OAUTH REQUEST');
    console.log('URL: https://oauth.bitrix.info/oauth/token/');
    console.log(
        'GRANT TYPE:',
        params.grant_type
    );

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json'
        }
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch (error) {
        throw new Error(
            `Bitrix OAuth returned invalid JSON. HTTP ${response.status}: ${text.slice(
                0,
                1000
            )}`
        );
    }

    if (!response.ok) {
        throw new Error(
            `Bitrix OAuth HTTP ${response.status}: ` +
            JSON.stringify(data)
        );
    }

    if (data.error) {
        throw new Error(
            `Bitrix OAuth error: ${data.error} ${data.error_description || ''}`
        );
    }

    return data;
}

async function exchangeAuthorizationCode(code) {
    console.log('');
    console.log('========================================');
    console.log('🔐 EXCHANGING AUTHORIZATION CODE');
    console.log('========================================');

    const auth = await bitrixOAuthRequest({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code
    });

    return auth;
}

async function refreshOAuthToken(refreshToken) {
    console.log('');
    console.log('========================================');
    console.log('🔄 REFRESHING OAUTH TOKEN');
    console.log('========================================');

    const auth = await bitrixOAuthRequest({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken
    });

    return auth;
}

function saveOAuthAuth(auth) {
    if (!auth || typeof auth !== 'object') {
        throw new Error('Invalid OAuth auth object');
    }

    oauthAuth = {
        ...auth,
        saved_at: new Date().toISOString()
    };

    console.log('');
    console.log('========================================');
    console.log('✅ OAUTH DATA RECEIVED');
    console.log('========================================');
    console.log(
        'ACCESS TOKEN:',
        mask(oauthAuth.access_token)
    );
    console.log(
        'REFRESH TOKEN:',
        mask(oauthAuth.refresh_token)
    );
    console.log(
        'DOMAIN:',
        oauthAuth.domain || BITRIX_DOMAIN
    );
    console.log(
        'MEMBER ID:',
        oauthAuth.member_id
            ? mask(oauthAuth.member_id)
            : 'MISSING'
    );
    console.log(
        'EXPIRES IN:',
        oauthAuth.expires_in || 'unknown'
    );
    console.log('========================================');

    /*
     * ВАЖНО:
     * Полные токены специально НЕ печатаем в Render logs.
     */
}

function getAccessToken() {
    if (!oauthAuth || !oauthAuth.access_token) {
        throw new Error(
            'OAuth access_token отсутствует. Сначала открой /oauth/start.'
        );
    }

    return oauthAuth.access_token;
}

async function bitrixOAuthCall(method, params = {}) {
    const accessToken = getAccessToken();

    const url =
        `https://${BITRIX_DOMAIN}/rest/${method}`;

    const body = {
        ...params,
        auth: accessToken
    };

    console.log('');
    console.log('➡️ BITRIX REST');
    console.log('METHOD:', method);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        body: JSON.stringify(body)
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch (error) {
        throw new Error(
            `Bitrix REST returned invalid JSON. HTTP ${response.status}: ${text.slice(
                0,
                1000
            )}`
        );
    }

    if (!response.ok) {
        throw new Error(
            `Bitrix REST HTTP ${response.status}: ` +
            JSON.stringify(data)
        );
    }

    if (data.error) {
        throw new Error(
            `Bitrix REST error: ${data.error} ${data.error_description || ''}`
        );
    }

    return data;
}

async function getOpenLines() {
    console.log('');
    console.log('========================================');
    console.log('🔎 GETTING BITRIX OPEN LINES');
    console.log('========================================');

    const data = await bitrixOAuthCall(
        'imopenlines.config.list.get',
        {
            PARAMS: {
                select: [
                    'ID',
                    'LINE_NAME',
                    'ACTIVE',
                    'XML_ID'
                ],
                order: {
                    ID: 'ASC'
                },
                filter: {},
                limit: 50,
                offset: 0
            },
            OPTIONS: {
                QUEUE: 'Y',
                CONFIG_QUEUE: 'Y'
            }
        }
    );

    const lines = Array.isArray(data.result)
        ? data.result
        : [];

    console.log('');
    console.log('========================================');
    console.log('📋 OPEN LINES');
    console.log('========================================');

    if (lines.length === 0) {
        console.log('❌ Открытых линий не найдено.');
    } else {
        lines.forEach((line, index) => {
            console.log('');
            console.log(`#${index + 1}`);
            console.log('ID:', line.ID);
            console.log('NAME:', line.LINE_NAME);
            console.log('ACTIVE:', line.ACTIVE);
            console.log('XML_ID:', line.XML_ID || '-');
        });
    }

    console.log('');
    console.log('========================================');

    return lines;
}

async function testOpenLine(lineId) {
    console.log('');
    console.log('========================================');
    console.log('🧪 TESTING OPEN LINE');
    console.log('========================================');
    console.log('LINE ID:', lineId);

    const data = await bitrixOAuthCall(
        'imopenlines.config.get',
        {
            CONFIG_ID: Number(lineId),
            WITH_QUEUE: 'Y',
            SHOW_OFFLINE: 'Y'
        }
    );

    const line = data.result;

    if (!line) {
        throw new Error(
            `Open line ${lineId} не найдена`
        );
    }

    console.log('');
    console.log('✅ OPEN LINE FOUND');
    console.log('ID:', line.ID);
    console.log('NAME:', line.LINE_NAME);
    console.log('ACTIVE:', line.ACTIVE);
    console.log('QUEUE:', Array.isArray(line.QUEUE)
        ? line.QUEUE.join(', ')
        : '-');

    return line;
}

/*
 * Главная страница.
 */
app.get('/', (req, res) => {
    res.type('text').send(
        [
            'MLK Bitrix OAuth Diagnostic',
            '',
            'OAuth start:',
            `${PUBLIC_BASE_URL}/oauth/start`,
            '',
            'Health:',
            `${PUBLIC_BASE_URL}/health`,
            '',
            'OAuth status:',
            `${PUBLIC_BASE_URL}/oauth/status`
        ].join('\n')
    );
});

/*
 * Health check для Render.
 */
app.get('/health', (req, res) => {
    res.json({
        ok: true,
        service: 'mlk-bitrix-oauth-diagnostic',
        time: new Date().toISOString(),
        bitrixDomain: BITRIX_DOMAIN,
        clientId: mask(CLIENT_ID),
        clientSecret: CLIENT_SECRET
            ? 'OK'
            : 'MISSING',
        publicBaseUrl: PUBLIC_BASE_URL
    });
});

/*
 * Показываем статус БЕЗ секретов.
 */
app.get('/oauth/status', (req, res) => {
    res.json({
        oauthReceived: Boolean(oauthAuth),
        accessToken: oauthAuth
            ? mask(oauthAuth.access_token)
            : null,
        refreshToken: oauthAuth
            ? mask(oauthAuth.refresh_token)
            : null,
        domain: oauthAuth
            ? oauthAuth.domain
            : null,
        memberId: oauthAuth
            ? mask(oauthAuth.member_id)
            : null,
        expiresIn: oauthAuth
            ? oauthAuth.expires_in
            : null,
        savedAt: oauthAuth
            ? oauthAuth.saved_at
            : null
    });
});

/*
 * Запускаем OAuth.
 *
 * Bitrix24 официально использует:
 * https://DOMAIN/oauth/authorize/?client_id=...
 */
app.get('/oauth/start', (req, res) => {
    const authorizeUrl =
        `https://${BITRIX_DOMAIN}/oauth/authorize/?` +
        new URLSearchParams({
            client_id: CLIENT_ID
        }).toString();

    console.log('');
    console.log('========================================');
    console.log('🔐 OAUTH START');
    console.log('========================================');
    console.log(
        'CLIENT ID:',
        mask(CLIENT_ID)
    );
    console.log(
        'REDIRECT URI:',
        `${PUBLIC_BASE_URL}/oauth/callback`
    );
    console.log('========================================');

    res.redirect(authorizeUrl);
});

/*
 * OAuth callback.
 *
 * После авторизации Bitrix передаст ?code=...
 */
app.get('/oauth/callback', async (req, res) => {
    try {
        const code = String(
            req.query.code || ''
        ).trim();

        if (!code) {
            const error =
                String(
                    req.query.error || ''
                ).trim();

            const description =
                String(
                    req.query.error_description || ''
                ).trim();

            return res.status(400).type('text').send(
                [
                    'OAuth ERROR',
                    '',
                    `error: ${error || 'unknown'}`,
                    `description: ${description || 'No authorization code received'}`
                ].join('\n')
            );
        }

        console.log('');
        console.log('========================================');
        console.log('⬅️ OAUTH CALLBACK RECEIVED');
        console.log('========================================');
        console.log(
            'CODE:',
            mask(code)
        );

        const auth = await exchangeAuthorizationCode(
            code
        );

        saveOAuthAuth(auth);

        let openLines = [];

        try {
            openLines = await getOpenLines();
        } catch (error) {
            console.error('');
            console.error(
                '⚠️ OAuth успешен, но получить Open Lines не удалось.'
            );
            console.error(error.message);
        }

        res.type('html').send(
            `
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>MLK Bitrix OAuth</title>
<style>
body {
    font-family: Arial, sans-serif;
    padding: 40px;
    line-height: 1.5;
}
.ok {
    color: green;
}
.warn {
    color: #a66a00;
}
.box {
    background: #f5f5f5;
    padding: 20px;
    border-radius: 10px;
    margin-top: 20px;
}
</style>
</head>
<body>

<h1 class="ok">✅ OAuth успешно получен</h1>

<p>
Bitrix24 авторизовал приложение.
</p>

<div class="box">
<strong>Domain:</strong>
${escapeHtml(auth.domain || BITRIX_DOMAIN)}
<br>

<strong>Member ID:</strong>
${escapeHtml(mask(auth.member_id))}
<br>

<strong>Access Token:</strong>
${escapeHtml(mask(auth.access_token))}
<br>

<strong>Refresh Token:</strong>
${escapeHtml(mask(auth.refresh_token))}
<br>

<strong>Expires In:</strong>
${escapeHtml(String(auth.expires_in || 'unknown'))}
</div>

<h2>Открытые линии</h2>

${
    openLines.length
        ? `
<ul>
${openLines
    .map(
        (line) =>
            `<li><strong>${escapeHtml(
                String(line.ID)
            )}</strong> — ${escapeHtml(
                String(line.LINE_NAME || '')
            )} — ACTIVE=${escapeHtml(
                String(line.ACTIVE || '')
            )}</li>`
    )
    .join('\n')}
</ul>
`
        : `
<p class="warn">
Открытые линии не получены. Смотри Render logs.
</p>
`
}

<p>
Теперь вернись в Render и посмотри логи.
</p>

</body>
</html>
`
        );
    } catch (error) {
        console.error('');
        console.error('========================================');
        console.error('❌ OAUTH CALLBACK ERROR');
        console.error('========================================');
        console.error(error);
        console.error('========================================');

        res.status(500).type('text').send(
            [
                'OAuth callback error',
                '',
                error.message
            ].join('\n')
        );
    }
});

/*
 * Ручная проверка Open Line после OAuth.
 *
 * Например:
 * /test/openline/15
 */
app.get('/test/openline/:id', async (req, res) => {
    try {
        if (!oauthAuth) {
            return res.status(400).json({
                ok: false,
                error: 'OAuth ещё не получен',
                open: `${PUBLIC_BASE_URL}/oauth/start`
            });
        }

        const line = await testOpenLine(
            req.params.id
        );

        res.json({
            ok: true,
            line: {
                id: line.ID,
                name: line.LINE_NAME,
                active: line.ACTIVE,
                xmlId: line.XML_ID || null
            }
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

/*
 * Простой endpoint для проверки webhook.
 * Сам webhook НЕ выводим в лог.
 */
app.get('/debug/config', (req, res) => {
    res.json({
        bitrixDomain: BITRIX_DOMAIN,
        clientId: mask(CLIENT_ID),
        clientSecret: CLIENT_SECRET
            ? 'OK'
            : 'MISSING',
        publicBaseUrl: PUBLIC_BASE_URL,
        webhookConfigured: Boolean(WEBHOOK_URL),
        oauthConfigured: Boolean(oauthAuth),
        oauthAccessToken: oauthAuth
            ? mask(oauthAuth.access_token)
            : null,
        oauthRefreshToken: oauthAuth
            ? mask(oauthAuth.refresh_token)
            : null
    });
});

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

requireEnv();

app.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('MLK BITRIX OAUTH DIAGNOSTIC');
    console.log('========================================');
    console.log('PORT:', PORT);
    console.log('BITRIX DOMAIN:', BITRIX_DOMAIN);
    console.log('CLIENT ID:', mask(CLIENT_ID));
    console.log(
        'CLIENT SECRET:',
        CLIENT_SECRET ? 'OK' : 'MISSING'
    );
    console.log('PUBLIC BASE URL:', PUBLIC_BASE_URL);
    console.log(
        'WEBHOOK:',
        WEBHOOK_URL ? 'CONFIGURED' : 'MISSING'
    );
    console.log('========================================');
    console.log('');
    console.log('🔐 OAUTH URL:');
    console.log(
        `${PUBLIC_BASE_URL}/oauth/start`
    );
    console.log('');
    console.log('❤️ HEALTH:');
    console.log(
        `${PUBLIC_BASE_URL}/health`
    );
    console.log('');
    console.log('========================================');
});