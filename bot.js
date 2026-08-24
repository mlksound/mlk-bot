process.on(
    'uncaughtException',
    err =>
        error(
            'Uncaught exception:',
            err.message
        )
);


// ============================================================
// START
// ============================================================

startup()
    .catch(
        e => {

            error(
                'Startup fatal:',
                e.message
            );

            process.exit(1);
        }
    );