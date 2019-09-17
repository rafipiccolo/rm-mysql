module.exports = {
    mysql: {
        host: '127.0.0.1',
        user: 'root',
        password: 'root',
        database: 'root',
        port: 3307,
        charset: 'utf8mb4',
    },
    schema: require('./schema.js'),
    logger: console,
}
