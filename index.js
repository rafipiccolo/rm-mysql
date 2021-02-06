'use strict';

var moment = require('moment');
var mysql = require('mysql');
var AppError = require('../error');

function Model(config) {
    var self = this;

    if (!config) return;

    self.logger = config.logger;
    self.modeldatafile = config.modeldata;

    self.validators = {
        clean: function (value) {
            return typeof value === 'undefined' || (typeof value === 'number' && isNaN(value)) ? null : value;
        },
        nullable: function (value) {
            return value === '' ? null : value;
        },
        nonNullable: function (value) {
            return value === null ? '' : value;
        },
        int: function (value) {
            if (value === null) return null;

            if (value === '') return 0;
            return parseInt(value);
        },
        float: function (value) {
            if (value === null) return null;

            if (value === '') return 0;
            return parseFloat(value);
        },
        double: function (value) {
            if (value === null) return null;

            if (value === '') return 0;
            return parseFloat(value);
        },
        varchar: function (value) {
            return value === null ? null : `${value}`;
        },
        tinyint: function (value) {
            if (value === null) return null;

            if (value === true || value === false) return value;
            return parseInt(value) ? true : false;
        },
        date: function (value) {
            if (value === null || value === '') return null;

            if (typeof value == 'string') value = value.replace(/(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1');
            if (typeof value == 'string') value = value.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1');
            return moment(value).format('YYYY-MM-DD');
        },
        datetime: function (value) {
            if (value === null || value === '') return null;

            if (typeof value == 'string') value = value.replace(/(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1');
            if (typeof value == 'string') value = value.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1');
            return moment(value).format('YYYY-MM-DD HH:mm:ss');
        },
        time: function (value) {
            if (value === null) return null;

            if (typeof value == 'string') value = value.replace(/h|H/, ':');

            if (typeof value == 'string' && value.match(/(\d{2}):(\d{2}):(\d{4})/)) return value;
            else if (typeof value == 'string' && value.match(/(\d{2}):(\d{2})/)) return value;
            else if (typeof value == 'string' && value.match(/(\d{2})/)) return `${value.replace(/:$/gm, '')}:00`;
            return null;
        },
        trim: function (value) {
            if (value === null) return null;

            return `${value}`.trim();
        },
    };
    self.validators.text = self.validators.varchar;
    self.validators.longtext = self.validators.varchar;
    self.validators.bigint = self.validators.int;
    self.modeldata = null;
    if (self.modeldatafile) self.modeldata = require('../saferequire')(self.modeldatafile);

    self.start(config);
}

Model.prototype.end = function (callback) {
    var self = this;

    if (self.pool) self.pool.end(callback);
    else if (self.connection) self.connection.end(callback);
    else callback();
};

Model.prototype.start = function (config) {
    var self = this;

    if (config.mysql.connectionLimit) {
        self.pool = mysql.createPool(config.mysql);
        // self.pool.on('acquire', function (connection) {
        //     console.info('Connection %d acquired', connection.threadId);
        // });
        // self.pool.on('connection', function (connection) {
        //     console.info('Connection started', connection.threadId);
        // });
        // self.pool.on('enqueue', function () {
        //     console.info('Waiting for available connection slot');
        // });
        // self.pool.on('release', function (connection) {
        //     console.info('Connection %d released', connection.threadId);
        // });
    } else {
        self.connection = mysql.createConnection(config.mysql);
        self.connection.connect(function (err) {
            if (err) {
                self.logger.info('fk:model', err.message, { err });
                return setTimeout(function () {
                    self.start(config);
                }, 1000);
            }
        });
        self.connection.on('error', function (err) {
            self.logger.info('fk:model', err.message, { err });
            setTimeout(function () {
                if (err.fatal) self.start(config);
            }, 1000);
        });
    }
};

Model.prototype.object2sql = function (obj) {
    var self = this;
    var x = [];

    for (var i in obj) x.push(`\`${i}\` = ${self.escape(obj[i])}`);
    return x.join(', ');
};

Model.prototype.orderBy = function (obj) {
    var self = this;
    var x = [];

    for (var i in obj) if (obj[i].toUpperCase() == 'ASC' || obj[i].toUpperCase() == 'DESC') x.push(`${i} ${obj[i]}`);

    if (x.length) return `ORDER BY ${x.join(', ')}`;
    return '';
};

Model.prototype.where = function (obj) {
    var self = this;
    var x = [];

    for (var i in obj) {
        if (typeof obj[i] == 'object') x.push(` ${obj[i].column} = ${self.escape(obj[i].value)}`);
        else x.push(`(${obj[i]})`);
    }

    if (x.length) return `WHERE ${x.join(' AND ')}`;
    return '';
};

Model.prototype.paginate = function (page, nb) {
    var self = this;
    var p = page || 0;
    return `LIMIT ${p * nb}, ${nb}`;
};

Model.prototype.query = function (sql, callback) {
    var self = this;

    self.queryFields(sql, function (err, results) {
        if (err) return callback(err);

        callback(null, results);
    });
};

Model.prototype.queryOne = function (sql, callback) {
    var self = this;
    self.query(sql, function (err, results, fields) {
        if (err) return callback(err);
        if (results.length == 0) return callback(new AppError('NORESULT', 'Aucun résultat', { sql, status: 404 }));

        var res = results[0];

        callback(null, res);
    });
};

Model.prototype.queryNb = function (sql, callback) {
    var self = this;
    self.queryOne(sql, function (err, res) {
        if (err) return callback(err);

        var keys = Object.keys(res);
        callback(null, res[keys[0]]);
    });
};

Model.prototype.queryFields = function (sql, callback) {
    var self = this;

    if (self.pool) {
        self.pool.getConnection(function (err, connection) {
            if (err) {
                connection.release();
                return callback(err);
            }

            connection.query(sql, function (err, rows, fields) {
                connection.release();

                if (err) return callback(new AppError('Error', 'Erreur sql dans model.query() from pool', { sql, err, status: 500 }));

                callback(null, rows, fields);
            });
        });
    } else {
        self.connection.query(sql, function (err, results, fields) {
            if (err && err.fatal) throw 'MYSQL FATAL RESTART';

            self.logger.info('fk:model', typeof sql == 'string' ? sql : sql.sql);

            if (err) return callback(new AppError('Error', 'Erreur sql dans model.query()', { sql, err, status: 500 }));

            callback(null, results, fields);
        });
    }
};

Model.prototype.queryNest = function (sql, callback) {
    var self = this;
    self.query({ sql, nestTables: true }, callback);
};

Model.prototype.escape = function (x) {
    var self = this;

    return self.connection.escape(x);
};

Model.prototype.escapeIds = function (ids) {
    var self = this;

    var res = [];
    ids.split(',').forEach(function (id) {
        if (id != '') res.push(parseFloat(id));
    });

    return res;
};

Model.prototype.clean = function (entity, obj) {
    var self = this;
    obj = obj || {};
    var res = {};

    for (var property in obj) {
        if (self.modeldata[entity] && self.modeldata[entity].columns[property]) {
            // supprime les champs undefined
            if (typeof obj[property] == 'undefined') {
                delete obj[property];
                continue;
            }

            // copie la valeur
            res[property] = self.validators['clean'](obj[property]);

            // nettoie la valeur via chaque validateur
            if (self.modeldata[entity].columns[property].nullable) res[property] = self.validators['nullable'](obj[property]);
            else res[property] = self.validators['nonNullable'](obj[property]);
            if (self.validators[self.modeldata[entity].columns[property].type])
                res[property] = self.validators[self.modeldata[entity].columns[property].type](res[property]);
            else {
                var details = {
                    entity,
                    property,
                    type: self.modeldata[entity].columns[property].type,
                };
                var err = new AppError('Error', `type non nettoyable ${self.modeldata[entity].columns[property].type}`, { details, status: 500 });
                self.logger.error('fk:model', err.message, { err }, function () {
                    throw err;
                });
            }

            // vérifie si maxlength est renseigné
            if (self.modeldata[entity].columns[property].maxlength && res[property])
                res[property] = res[property].substr(0, self.modeldata[entity].columns[property].maxlength);
        } else {
            // self.logger.info('fk:model', 'champs inutilisé ' + property);
        }
    }

    return res;
};

Model.prototype.setDefault = function (entity, obj) {
    var self = this;
    for (var column in self.modeldata[entity].columns)
        if (self.modeldata[entity].columns[column].default && (obj[column] === null || typeof obj[column] == 'undefined'))
            obj[column] = self.modeldata[entity].columns[column].default;
};

Model.prototype.insert = function (entity, obj, callback) {
    var self = this;
    self.setDefault(entity, obj);
    obj = self.clean(entity, obj);
    var sql = self.insertSql(entity, obj);
    self.query(sql, function (err, result) {
        if (err) return callback(err);

        obj.id = result.insertId;
        callback(null, obj);
    });
};

Model.prototype.insertMulti = function (entity, objs, callback) {
    var self = this;

    var columns = [];
    for (var property in self.modeldata[entity].columns) columns.push(property);

    var s = [];

    for (var i = 0; i < objs.length; i++) {
        var values = [];
        var obj = objs[i];

        for (var property in self.modeldata[entity].columns) {
            if (obj[property]) values.push(self.escape(obj[property]));
            else if (property == 'createdAt' || property == 'updatedAt') values.push('NOW()');
            else if (self.modeldata[entity].columns[property].default) values.push(self.escape(self.modeldata[entity].columns[property].default));
            else if (self.modeldata[entity].columns[property].nullable || self.modeldata[entity].columns[property].primary) values.push('NULL');
            else values.push(self.escape(''));
        }

        s.push(` (${values.join(',')})`);
    }
    var sql = `insert into ${entity} (${columns.join(',')}) values ${s.join(',')}`;

    self.query(sql, callback);
};

Model.prototype.insertIgnore = function (entity, obj, callback) {
    var self = this;
    self.setDefault(entity, obj);
    obj = self.clean(entity, obj);
    var sql = self.insertSql(entity, obj, 1);
    self.query(sql, function (err, result) {
        if (err) return callback(err);

        obj.id = result.insertId;
        callback(null, obj);
    });
};
Model.prototype.insertSql = function (entity, obj, ignore) {
    var self = this;
    var addInsert = [];
    if (self.modeldata[entity].columns['updatedAt'] && typeof obj.updatedAt == 'undefined') addInsert.push('updatedAt = now()');
    if (self.modeldata[entity].columns['createdAt'] && typeof obj.createdAt == 'undefined') addInsert.push('createdAt = now()');

    if (Object.keys(obj).length) addInsert.push(self.object2sql(obj));

    return `insert ${ignore ? 'ignore' : ''} into \`${entity}\` set ${addInsert.join(',')}`;
};

Model.prototype.update = function (entity, obj, callback) {
    var self = this;
    obj = self.clean(entity, obj);
    var sql = self.updateSql(entity, obj);
    self.query(sql, function (err, result) {
        if (err) return callback(err);

        callback(null, obj);
    });
};
Model.prototype.updateSql = function (entity, obj, upsert) {
    var self = this;

    if (upsert) {
        var tmp = `UPDATE ${self.object2sql(obj)}`;
        if (self.modeldata[entity].columns['updatedAt']) tmp += ', updatedAt = now()';
        return tmp;
    }

    var addUpdate = '';
    if (self.modeldata[entity].columns['updatedAt']) addUpdate += ', updatedAt = now()';

    addUpdate += ' WHERE ';

    var updates = [];
    for (var property in obj) if (self.modeldata[entity].columns[property].primary) updates.push(` \`${property}\` = ${self.escape(obj[property])} `);

    addUpdate += updates.join(' AND ');

    return `UPDATE \`${entity}\` SET ${self.object2sql(obj)} ${addUpdate}`;
};

Model.prototype.insertOrUpdate = function (entity, obj, callback) {
    var self = this;
    obj = self.clean(entity, obj);
    var sqlInsert = self.insertSql(entity, obj);
    var sqlUpdate = self.updateSql(entity, obj, 1);
    var sql = `${sqlInsert} ON DUPLICATE KEY ${sqlUpdate}`;
    self.query(sql, function (err, result) {
        if (err) return callback(err);

        if (result.insertId) obj.id = result.insertId;

        callback(null, obj);
    });
};

Model.prototype.delete = function (entity, id, callback) {
    var self = this;
    self.query(`DELETE FROM \`${entity}\` WHERE id = ${self.escape(id)}`, callback);
};

// PROMISES

Model.prototype.queryNestPromise = function (s) {
    return new Promise((resolve, reject) => {
        this.queryNest(s, function (err, data) {
            if (err) return reject(err);

            resolve(data);
        });
    });
};

Model.prototype.queryOnePromise = function (s) {
    return new Promise((resolve, reject) => {
        this.queryOne(s, function (err, data) {
            if (err) return reject(err);

            resolve(data);
        });
    });
};

Model.prototype.queryPromise = function (s) {
    return new Promise((resolve, reject) => {
        this.query(s, function (err, data) {
            if (err) return reject(err);

            resolve(data);
        });
    });
};

Model.prototype.deletePromise = function (s, d) {
    return new Promise((resolve, reject) => {
        this.delete(s, d, function (err, data) {
            if (err) return reject(err);

            resolve(data);
        });
    });
};

Model.prototype.queryNbPromise = function (s) {
    return new Promise((resolve, reject) => {
        this.queryNb(s, function (err, data) {
            if (err) return reject(err);

            resolve(data);
        });
    });
};

Model.prototype.updatePromise = function (s, d) {
    return new Promise((resolve, reject) => {
        this.update(s, d, function (err, data) {
            if (err) return reject(err);

            resolve(data);
        });
    });
};

Model.prototype.insertPromise = function (s, d) {
    return new Promise((resolve, reject) => {
        this.insert(s, d, function (err, data) {
            if (err) return reject(err);

            resolve(data);
        });
    });
};

Model.prototype.insertIgnorePromise = function (s, d) {
    return new Promise((resolve, reject) => {
        this.insertIgnore(s, d, function (err, data) {
            if (err) return reject(err);

            resolve(data);
        });
    });
};

Model.prototype.insertOrUpdatePromise = function (s, d) {
    return new Promise((resolve, reject) => {
        this.insertOrUpdate(s, d, function (err, data) {
            if (err) return reject(err);

            resolve(data);
        });
    });
};

module.exports = Model;
