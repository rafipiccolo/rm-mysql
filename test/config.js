module.exports = {
    mysql: {
        host: '127.0.0.1',
        user: 'root',
        password: 'root',
        database: 'root',
        port: 3307,
        charset: 'utf8mb4',
    },
    schema: {
        user: {
            columns: {
                id: { nullable: false, type: 'int', autoincrement: true, primary: true },
                name: { nullable: true, type: 'varchar', maxlength: 255 },
            },
            comment: '',
        }
    },
    logger: console,
}
