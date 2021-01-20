'use strict';

var moment = require('moment');
var mysql = require('mysql');
var AppError = require('./lib/AppError.js');
var pkg = require('./package.json');

function Model(config) {
    var self = this;

    self.logger = config.logger;
    self.schema = config.schema;
    self.start(config.mysql);
}

Model.prototype.end = function (callback) {
    var self = this;

    if (self.pool) self.pool.end(callback);
    else if (self.connection) self.connection.end(callback);
    else callback();
};

Model.prototype.start = function (config) {
    var self = this;

    if (config.connectionLimit) {
        self.pool = mysql.createPool(config);
    } else {
        self.connection = mysql.createConnection(config);
        self.connection.connect(function (err) {
            if (err) {
                if (self.logger) self.logger.error(pkg.name, 'cannot connect to mysql server', { err });

                return setTimeout(function () {
                    self.start(config);
                }, 1000);
            }

            if (config.charset)
                self.connection.query('SET NAMES ' + self.escape(config.charset), function (err) {
                    if (err) throw err;
                });
        });
        self.connection.on('error', function (err) {
            if (err.fatal) self.start(config);
        });
    }
};

Model.prototype.object2sql = function (obj) {
    var self = this;
    var x = [];

    for (var i in obj) x.push('`' + i + '` = ' + self.escape(obj[i]));
    return x.join(', ');
};

Model.prototype.orderBy = function (obj) {
    var self = this;
    var x = [];

    for (var i in obj) if (obj[i].toUpperCase() == 'ASC' || obj[i].toUpperCase() == 'DESC') x.push(i + ' ' + obj[i]);

    if (x.length) return 'ORDER BY ' + x.join(', ');
    else return '';
};

Model.prototype.where = function (obj) {
    var self = this;
    var x = [];

    for (var i in obj) {
        if (typeof obj[i] == 'object') x.push(' ' + obj[i].column + ' = ' + self.escape(obj[i].value));
        else x.push('(' + obj[i] + ')');
    }

    if (x.length) return 'WHERE ' + x.join(' AND ');
    else return '';
};

Model.prototype.paginate = function (page, nb) {
    var self = this;
    var p = page || 0;
    return 'LIMIT ' + p * nb + ', ' + nb;
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
        if (results.length == 0) return callback(new AppError('NORESULT', 'Aucun résultat', { sql }));

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

                if (err) return callback(new AppError('Error', "Can't execute sql request from pool", { sql, err }));

                callback(null, rows, fields);
            });
        });
    } else {
        self.connection.query(sql, function (err, results, fields) {
            if (self.logger) self.logger.info(pkg.name, typeof sql == 'string' ? sql : sql.sql);

            if (err) return callback(new AppError('Error', "Can't execute sql request", { sql, err }));

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
    ids.split(',').map(function (id) {
        if (id != '') res.push(parseFloat(id));
    });

    return res;
};

Model.prototype.clean = function (entity, obj) {
    var self = this;
    obj = obj || {};
    obj = JSON.parse(JSON.stringify(obj));

    for (var property in obj) {
        if (self.schema[entity] && self.schema[entity].columns[property]) {
            // supprime les champs undefined
            if (typeof obj[property] == 'undefined') {
                delete obj[property];
                continue;
            }

            // copie la valeur
            obj[property] = validators['clean'](obj[property]);

            // nettoie la valeur via chaque validateur
            if (self.schema[entity].columns[property].nullable) obj[property] = validators['nullable'](obj[property]);
            else obj[property] = validators['nonNullable'](obj[property]);
            if (validators[self.schema[entity].columns[property].type])
                obj[property] = validators[self.schema[entity].columns[property].type](obj[property]);
            else {
                var type = self.schema[entity].columns[property].type;
                var err = new AppError('Error', 'unknown type ' + type + ' for cleaning', {
                    entity,
                    property,
                    type,
                });
                throw err;
            }

            // vérifie si maxlength est renseigné
            if (self.schema[entity].columns[property].maxlength && obj[property])
                obj[property] = obj[property].substr(0, self.schema[entity].columns[property].maxlength);
        } else {
            // if (self.logger) self.logger.info(pkg.name, 'champs inutilisé ' + property);
        }
    }

    return obj;
};

Model.prototype.setDefault = function (entity, obj) {
    var self = this;
    for (var column in self.schema[entity].columns)
        if (self.schema[entity].columns[column].default && (obj[column] == null || typeof obj[column] == 'undefined'))
            obj[column] = self.schema[entity].columns[column].default;
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
    for (var property in self.schema[entity].columns) columns.push(property);

    var s = [];

    for (var i = 0; i < objs.length; i++) {
        var values = [];
        var obj = objs[i];

        for (var property in self.schema[entity].columns) {
            if (typeof obj[property] !== 'undefined' && obj[property] !== null) values.push(self.escape(obj[property]));
            else if (property == 'createdAt' || property == 'updatedAt') values.push('NOW()');
            else if (self.schema[entity].columns[property].default) values.push(self.escape(self.schema[entity].columns[property].default));
            else if (self.schema[entity].columns[property].nullable || self.schema[entity].columns[property].primary) values.push('NULL');
            else values.push(self.escape(''));
        }

        s.push(' (' + values.join(',') + ')');
    }
    var sql = 'insert into ' + entity + ' (' + columns.join(',') + ') values ' + s.join(',');

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
    var addInsert = '';
    if (self.schema[entity].columns['updatedAt'] && typeof obj.updatedAt == 'undefined') addInsert += ', updatedAt = now()';
    if (self.schema[entity].columns['createdAt'] && typeof obj.createdAt == 'undefined') addInsert += ', createdAt = now()';
    return 'insert ' + (ignore ? 'ignore' : '') + ' into `' + entity + '` set ' + self.object2sql(obj) + ' ' + addInsert;
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
        var tmp = 'UPDATE ' + self.object2sql(obj);
        if (self.schema[entity].columns['updatedAt']) tmp += ', updatedAt = now()';
        return tmp;
    }

    var addUpdate = '';
    if (self.schema[entity].columns['updatedAt']) addUpdate += ', updatedAt = now()';

    addUpdate += ' WHERE ';

    var updates = [];
    for (var property in obj)
        if (self.schema[entity].columns[property].primary) updates.push(' `' + property + '` = ' + self.escape(obj[property]) + ' ');

    addUpdate += updates.join(' AND ');

    return 'UPDATE `' + entity + '` SET ' + self.object2sql(obj) + ' ' + addUpdate;
};

Model.prototype.insertOrUpdate = function (entity, obj, callback) {
    var self = this;
    obj = self.clean(entity, obj);
    var sqlInsert = self.insertSql(entity, obj);
    var sqlUpdate = self.updateSql(entity, obj, 1);
    var sql = sqlInsert + ' ON DUPLICATE KEY ' + sqlUpdate;
    self.query(sql, function (err, result) {
        if (err) return callback(err);

        if (result.insertId) obj.id = result.insertId;

        callback(null, obj);
    });
};

Model.prototype.delete = function (entity, id, callback) {
    var self = this;
    self.query('DELETE FROM `' + entity + '` WHERE id = ' + self.escape(id), callback);
};

var validators = {
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
        if (value == null) return null;

        if (value === '') return 0;
        else return parseInt(value);
    },
    float: function (value) {
        if (value == null) return null;

        if (value === '') return 0;
        else return parseFloat(value);
    },
    double: function (value) {
        if (value == null) return null;

        if (value === '') return 0;
        else return parseFloat(value);
    },
    varchar: function (value) {
        return value == null ? null : value + '';
    },
    tinyint: function (value) {
        if (value == null) return null;

        if (value === true || value === false) return value;
        else return parseInt(value) ? true : false;
    },
    date: function (value) {
        if (value == null || value == '') return null;

        if (typeof value == 'string') value = value.replace(/(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1');
        if (typeof value == 'string') value = value.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1');
        return moment(value).format('YYYY-MM-DD');
    },
    datetime: function (value) {
        if (value == null || value == '') return null;

        if (typeof value == 'string') value = value.replace(/(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1');
        if (typeof value == 'string') value = value.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1');
        return moment(value).format('YYYY-MM-DD HH:mm:ss');
    },
    time: function (value) {
        if (value == null) return null;

        if (typeof value == 'string') value = value.replace(/h|H/, ':');

        if (typeof value == 'string' && value.match(/(\d{2}):(\d{2}):(\d{4})/)) return value;
        else if (typeof value == 'string' && value.match(/(\d{2}):(\d{2})/)) return value;
        else if (typeof value == 'string' && value.match(/(\d{2})/)) return value.replace(/:$/gm, '') + ':00';
        else return null;
    },
    trim: function (value) {
        if (value == null) return null;

        return (value + '').trim();
    },
};
validators.text = validators.varchar;
validators.longtext = validators.varchar;
validators.bigint = validators.int;

module.exports = Model;
