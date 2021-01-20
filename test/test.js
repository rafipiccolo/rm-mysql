var assert = require('assert');
var Model = require('../index.js');
var model = new Model({
    mysql: {
        host: 'localhost',
        user: 'root',
        password: 'root',
        database: 'root',
        port: 3307,
    },
    schema: require('./schema.js'),
    logger: console,
});

describe('model.js', function () {
    afterEach(function () {
        if (this.currentTest.state === 'failed') {
            model.end();
        }
    });

    it('queryNb select 2', function (done) {
        model.queryNb('select 2', function (err, nb) {
            assert.ifError(err);
            assert.equal(nb, 2);
            done();
        });
    });
    it('queryOne select 2', function (done) {
        model.queryOne('select 2', function (err, line) {
            assert.ifError(err);
            assert.equal(Object.keys(line).length, 1);
            done();
        });
    });
    it('query select 2', function (done) {
        model.query('select 2', function (err, results) {
            assert.ifError(err);
            assert.equal(results.length, 1);
            assert.equal(Object.keys(results[0]).length, 1);
            done();
        });
    });
    it('queryFields select 2', function (done) {
        model.queryFields('select 2', function (err, results) {
            assert.ifError(err);
            assert.equal(results.length, 1);
            assert.equal(Object.keys(results[0]).length, 1);
            assert.equal(Object.keys(results[0]).length, 1);
            done();
        });
    });
    it('query with order where and limit', function (done) {
        model.query(`select ${model.escape(2)} ${model.orderBy({})} ${model.where([])} ${model.paginate(0, 1)}`, function (err, results) {
            assert.ifError(err);
            assert.equal(results.length, 1);
            assert.equal(Object.keys(results[0]).length, 1);
            assert.equal(Object.keys(results[0]).length, 1);
            done();
        });
    });
    it('insertMulti', function (done) {
        model.insertMulti('user', [{ name: 'toto' }, { name: 'solo' }, { name: 'lolo' }], function (err, results) {
            assert.ifError(err);
            done();
        });
    });
    it('close connection', function (done) {
        model.end();
        done();
    });
});
