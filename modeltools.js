#!/usr/bin/env node

var mysql = require('mysql');
var config = require('./config.js');
var connection = mysql.createConnection({
    host: config.mysql.host,
    user: config.mysql.user,
    password: config.mysql.password,
    charset: config.mysql.charset || 'utf8mb4',
    multipleStatements: true,
});
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
var spawn = require('child_process').spawn;
var fs = require('fs');

require('yargs')
    .usage('Usage: $0 <command> [arguments]')
    .help('h')
    .alias('h', 'help')
    .version(require('./package.json').version)
    .strict()
    .wrap(null)
    .demandCommand(1, 'Please choose a command')

    .command(
        'create',
        "create database from config's data",
        (yargs) => {
            yargs.example('$0 create');
        },
        create
    )

    .command(
        'update',
        'show sql commands needed to sync database according to schema.js',
        (yargs) => {
            yargs.example('$0 update').option('f', {
                alias: 'force',
                describe: 'autoexecute : do not ask for execution',
            });
        },
        update
    )

    .command(
        'generate',
        'generate schema.js from database',
        (yargs) => {
            yargs.example('$0 generate');
        },
        generate
    )

    .command(
        'drop',
        'drop database',
        (yargs) => {
            yargs.example('$0 drop');
        },
        drop
    )

    .command(
        'dump',
        'dump database to base.sql',
        (yargs) => {
            yargs.example('$0 dump');
        },
        dump
    )

    .command(
        'load [file]',
        'load database from base.sql or specified file',
        (yargs) => {
            yargs
                .example('$0 load')
                .example('$0 load base.sql')
                .positional('file', {
                    describe: 'specify the file to load (default base.sql)',
                    default: 'base.sql',
                });
        },
        load
    )

    .command(
        'exec <sql>',
        'execute custom sql',
        (yargs) => {
            yargs.example('$0 exec "select 1"').positional('sql', {
                describe: 'specify the query to execute',
            });
        },
        exec
    ).argv;

if (!config.schema) {
    console.log('    specify a schema file in config file');
    exit();
}

function exit(err) {
    if (err) throw err;

    rl.close();
    process.exit(0);
}

function exec(argv) {
    connection.changeUser({ database: config.mysql.database }, function(err) {
        if (err) throw err;

        connection.query(argv.sql, function(err, results) {
            if (err) throw err;

            console.log(results);
            exit();
        });
    });
}

function load(argv) {
    connection.changeUser({ database: config.mysql.database }, function(err) {
        if (err) throw err;

        var sql = fs.readFileSync(argv.file).toString('utf8');
        connection.query(sql, function(err) {
            exit(err);
        });
    });
}

function dump(argv) {
    var mysqldump = spawn('mysqldump', ['-u', config.mysql.user, '-p' + config.mysql.password, config.mysql.database]);

    var output = fs.createWriteStream(__dirname + '/base.sql');
    mysqldump.stdout.pipe(output);

    mysqldump.stderr.on('data', function(data) {
        console.log(data.toString());
    });

    mysqldump.on('exit', (code) => {
        console.log(`child process exited with code ${code}`);
        exit();
    });
}

function drop(argv) {
    connection.query('DROP DATABASE IF EXISTS `' + config.mysql.database + '`;', function(err) {
        exit(err);
    });
}

function create(argv) {
    connection.query('CREATE DATABASE IF NOT EXISTS `' + config.mysql.database + '`;', function(err) {
        exit(err);
    });
}

function generate(argv) {
    connection.changeUser({ database: config.mysql.database }, function(err) {
        if (err) throw err;

        getModelFromDatabase(function(err, schema) {
            var s = '';
            //s = require('util').inspect(schema, {depth: 4});
            s += '{\n';
            for (var i in schema) {
                s += '  ' + i + ': ';
                s += '{\n';
                for (var j in schema[i]) {
                    s += '    ' + j + ': ';

                    if (j == 'columns' || j == 'uniques') {
                        s += '{\n';
                        for (var k in schema[i][j]) {
                            var columnlines = require('util')
                                .inspect(schema[i][j][k])
                                .split('\n');
                            var column = '';
                            columnlines.forEach(function(columnline) {
                                column += ' ' + columnline.trim();
                            });
                            s += '      ' + k + ':' + column + ',\n';
                        }
                        s += '    },\n';
                    } else s += JSON.stringify(schema[i][j]) + ',\n';
                }
                s += '  },\n';
            }
            s += '}\n';

            require('fs').writeFile(config.schema, 'module.exports = ' + s, function(err) {
                exit(err);
            });
        });
    });
}

function update(argv) {
    connection.changeUser({ database: config.mysql.database }, function(err) {
        if (err) throw err;

        getModelFromDatabase(function(err, database) {
            if (err) return exit(err);

            var schema = require(config.schema);
            var toexecute = [];
            var toexecutelast = [];

            // cree un tableau de cle unique vide si il n'y en a pas
            for (var table in schema) {
                schema[table].uniques = schema[table].uniques || {};
                if (database[table]) database[table].uniques = database[table].uniques || {};
            }

            // set utf8 par defaut
            for (var table in schema) {
                for (var column in schema[table].columns) {
                    if (
                        (schema[table].columns[column].type == 'varchar' || schema[table].columns[column].type == 'text') &&
                        !schema[table].columns[column].collation
                    )
                        schema[table].columns[column].collation = 'utf8mb4_general_ci';
                }
            }

            // table existe dans la base mais pas dans le schema
            for (var table in database) {
                if (!schema[table]) toexecute.push('DROP table IF EXISTS `' + table + '`;');
            }

            // table existe dans le schema mais pas dans la base
            for (var table in schema) {
                if (!database[table]) {
                    // COLUMNS
                    var lines = [];
                    for (var column in schema[table].columns) lines.push(column2sql(column, schema[table].columns[column]));

                    // PK
                    var pk = pk2sql(schema[table].columns);
                    if (pk) lines.push(pk);

                    toexecute.push('CREATE TABLE `' + table + '` (' + lines.join(',\n') + ');\n');

                    // FK
                    for (var column in schema[table].columns)
                        if (schema[table].columns[column].foreign)
                            toexecutelast.push('ALTER TABLE `' + table + '` ADD ' + fk2sql(column, schema[table].columns[column]) + ';');

                    // UNIQUE
                    for (var name in schema[table].uniques)
                        toexecute.push('ALTER TABLE `' + table + '` ADD ' + uniques2sql(name, schema[table].uniques[name]) + ';\n');
                }
            }

            // la table existe dans la base et dans le model
            for (var table in schema) {
                if (schema[table]) {
                    if (!database[table] || (schema[table].comment || '') != (database[table].comment || ''))
                        toexecutelast.push('ALTER TABLE `' + table + '` COMMENT=' + connection.escape(schema[table].comment) + ';');
                }
            }

            // la colonne existe dans la base mais pas dans le schema
            for (var table in database) {
                if (schema[table]) {
                    // UNIQUE
                    for (var name in database[table].uniques)
                        if (!schema[table].uniques[name])
                            if (database[table].uniques[name]) toexecute.push('ALTER TABLE `' + table + '` DROP INDEX `' + name + '`;\n');

                    for (var column in database[table].columns) {
                        if (!schema[table].columns[column]) {
                            // FK
                            if (database[table].columns[column].foreign)
                                toexecute.push(
                                    'ALTER TABLE `' + table + '` DROP FOREIGN KEY `' + database[table].columns[column].foreign.name + '`;'
                                );

                            // COLUMN
                            toexecute.push('ALTER TABLE `' + table + '` DROP COLUMN `' + column + '`;');
                        }
                    }
                }
            }

            // la colonne existe dans le schema mais pas dans la base
            for (var table in schema) {
                if (database[table]) {
                    for (var column in schema[table].columns) {
                        if (!database[table].columns[column]) {
                            // COLUMN
                            toexecute.push('ALTER TABLE `' + table + '` ADD COLUMN ' + column2sql(column, schema[table].columns[column]) + ';');

                            // FK
                            if (schema[table].columns[column].foreign)
                                toexecutelast.push('ALTER TABLE `' + table + '` ADD ' + fk2sql(column, schema[table].columns[column]) + ';');
                        }
                    }
                    for (var name in schema[table].uniques)
                        if (!database[table].uniques[name])
                            if (schema[table].uniques[name])
                                toexecute.push('ALTER TABLE `' + table + '` ADD ' + uniques2sql(name, schema[table].uniques[name]) + ';\n');
                }
            }

            // la colonne existe dans le schema et aussi dans la base
            for (var table in schema) {
                if (database[table]) {
                    var regenerateprimary = false;
                    var dropprimary = false;

                    for (var column in schema[table].columns) {
                        if (database[table].columns[column]) {
                            if (diffObject(database[table].columns[column], schema[table].columns[column])) {
                                // supprime la cle si elle existe
                                if (database[table].columns[column].foreign)
                                    toexecute.push(
                                        'ALTER TABLE `' + table + '` DROP FOREIGN KEY `' + database[table].columns[column].foreign.name + '`;'
                                    );

                                // si la structure de donnée est différente
                                if (
                                    database[table].columns[column].nullable != schema[table].columns[column].nullable ||
                                    database[table].columns[column].type != schema[table].columns[column].type ||
                                    (database[table].columns[column].maxlength || '') != (schema[table].columns[column].maxlength || '') ||
                                    (database[table].columns[column].comment || '') != (schema[table].columns[column].comment || '') ||
                                    (database[table].columns[column].default || '') != (schema[table].columns[column].default || '') ||
                                    (database[table].columns[column].autoincrement || '') != (schema[table].columns[column].autoincrement || '') ||
                                    (database[table].columns[column].collation || '') != (schema[table].columns[column].collation || '')
                                )
                                    toexecute.push(
                                        'ALTER TABLE `' + table + '` MODIFY COLUMN ' + column2sql(column, schema[table].columns[column]) + ';'
                                    );

                                // recree la cle si elle existe
                                if (schema[table].columns[column].foreign)
                                    toexecutelast.push('ALTER TABLE `' + table + '` ADD ' + fk2sql(column, schema[table].columns[column]) + ';');

                                if (schema[table].columns[column].primary) regenerateprimary = true;
                                if (database[table].columns[column].primary) dropprimary = true;
                            }
                        }
                    }

                    // PK
                    if (regenerateprimary) {
                        var pk = pk2sql(schema[table].columns);
                        if (pk) toexecutelast.push('ALTER TABLE `' + table + '` ' + (dropprimary ? 'DROP PRIMARY KEY, ' : '') + ' ADD ' + pk + ';');
                    }

                    // UNIQUE
                    for (var name in schema[table].uniques) {
                        if (
                            database[table].uniques[name] &&
                            schema[table].uniques[name] &&
                            JSON.stringify(database[table].uniques[name]) != JSON.stringify(schema[table].uniques[name])
                        ) {
                            toexecute.push(
                                'ALTER TABLE `' +
                                    table +
                                    '` DROP INDEX `' +
                                    name +
                                    '`, ADD ' +
                                    uniques2sql(name, schema[table].uniques[name]) +
                                    ';\n'
                            );
                        }
                    }
                }
            }

            if (!toexecute.length && !toexecutelast.length) return exit(err);

            var all = '';
            all += '/*!40101 SET NAMES utf8mb4 */;\n';
            all += '/*!40014 SET FOREIGN_KEY_CHECKS=0 */;\n';
            all += "/*!40101 SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;\n";
            all += '\n';
            all += toexecute.join('\n') + '\n';
            all += '\n';
            all += toexecutelast.join('\n') + '\n';
            console.log(all);

            if (argv.force) {
                return connection.query(all, function(err) {
                    exit(err);
                });
            }

            rl.question('Execute ? ', function(answer) {
                if (/^y|o/.test(answer)) {
                    connection.query(all, function(err) {
                        exit(err);
                    });
                } else {
                    exit(err);
                }
            });
        });
    });
}

function column2sql(name, obj) {
    return (
        '`' +
        name +
        '` ' +
        obj.type +
        (obj.maxlength ? '(' + obj.maxlength + ')' : '') +
        ' ' +
        (obj.nullable ? 'NULL' : 'NOT NULL') +
        (typeof obj.default != 'undefined' ? ' DEFAULT ' + connection.escape(obj.default) : '') +
        ' ' +
        (obj.autoincrement ? 'AUTO_INCREMENT' : '') +
        ' ' +
        (obj.collation ? " COLLATE '" + obj.collation + "' " : '') +
        ' ' +
        (obj.comment ? 'COMMENT ' + connection.escape(obj.comment) : '')
    );
}

function uniques2sql(name, uniquedata) {
    var lines = [];

    for (var column in uniquedata) lines.push('`' + uniquedata[column] + '`');
    return 'CONSTRAINT `' + name + '` UNIQUE (' + lines.join(',') + ')';
}

function pk2sql(columns) {
    var primaries = [];
    for (var column in columns) if (columns[column].primary) primaries.push(column);

    if (primaries.length == 0) return '';

    var lines = [];
    for (var column in primaries) {
        lines.push('`' + primaries[column] + '`');
    }
    var sql = 'PRIMARY KEY (' + lines.join(',') + ')';
    return sql;
}

function fk2sql(name, obj) {
    var sql = '';

    sql += 'CONSTRAINT `' + obj.foreign.name + '` FOREIGN KEY (';
    sql += '`' + name + '`';
    sql +=
        ') REFERENCES `' +
        obj.foreign.table +
        '` (`' +
        obj.foreign.column +
        '`) ON UPDATE ' +
        obj.foreign.update +
        ' ON DELETE ' +
        obj.foreign.delete;
    return sql;
}

function getModelFromDatabase(callback) {
    var schema = {};
    connection.query(
        'SELECT `TABLE_NAME`, `TABLE_COMMENT` FROM `INFORMATION_SCHEMA`.`TABLES` WHERE `TABLE_SCHEMA`=' + connection.escape(config.mysql.database),
        function(err, results) {
            if (err) return callback(err);

            results.forEach(function(result) {
                schema[result.TABLE_NAME] = {
                    columns: {},
                    uniques: {},
                    comment: result.TABLE_COMMENT,
                };
            });

            // récupère les colonnes
            connection.query(
                'SELECT `TABLE_NAME`, `COLUMN_NAME`, `COLLATION_NAME`, `COLUMN_DEFAULT`, `IS_NULLABLE`, `DATA_TYPE`, `CHARACTER_MAXIMUM_LENGTH`, `EXTRA`, `COLUMN_COMMENT` FROM `INFORMATION_SCHEMA`.`COLUMNS` WHERE `TABLE_SCHEMA`=' +
                    connection.escape(config.mysql.database),
                function(err, results) {
                    if (err) return callback(err);

                    results.forEach(function(result) {
                        schema[result.TABLE_NAME].columns[result.COLUMN_NAME] = {};

                        schema[result.TABLE_NAME].columns[result.COLUMN_NAME].nullable = result.IS_NULLABLE == 'YES';
                        schema[result.TABLE_NAME].columns[result.COLUMN_NAME].type = result.DATA_TYPE;
                        if (result.COLUMN_DEFAULT) schema[result.TABLE_NAME].columns[result.COLUMN_NAME].default = result.COLUMN_DEFAULT;

                        if (result.EXTRA == 'auto_increment') schema[result.TABLE_NAME].columns[result.COLUMN_NAME].autoincrement = true;

                        if (result.CHARACTER_MAXIMUM_LENGTH)
                            schema[result.TABLE_NAME].columns[result.COLUMN_NAME].maxlength = result.CHARACTER_MAXIMUM_LENGTH;

                        if (result.COLUMN_COMMENT) schema[result.TABLE_NAME].columns[result.COLUMN_NAME].comment = result.COLUMN_COMMENT;

                        if (result.COLLATION_NAME) schema[result.TABLE_NAME].columns[result.COLUMN_NAME].collation = result.COLLATION_NAME;
                    });

                    // récupère les cles primaires
                    connection.query(
                        `SELECT t.TABLE_NAME, k.COLUMN_NAME
                FROM information_schema.table_constraints t
                JOIN information_schema.key_column_usage k
                USING(constraint_name,table_schema,table_name)
                WHERE t.constraint_type='PRIMARY KEY'
                AND t.table_schema=` + connection.escape(config.mysql.database),
                        function(err, results) {
                            if (err) return callback(err);

                            results.forEach(function(result) {
                                schema[result.TABLE_NAME].columns[result.COLUMN_NAME].primary = true;
                            });

                            // récupère les cles uniques
                            connection.query(
                                `SELECT t.TABLE_NAME, group_concat(k.COLUMN_NAME order by k.ORDINAL_POSITION) as columnnames, k.CONSTRAINT_NAME
                    FROM information_schema.table_constraints t
                    JOIN information_schema.key_column_usage k
                    USING(constraint_name,table_schema,table_name)
                    WHERE t.constraint_type='UNIQUE'
                    AND t.table_schema=` +
                                    connection.escape(config.mysql.database) +
                                    `
                    group by t.TABLE_NAME`,
                                function(err, results) {
                                    if (err) return callback(err);

                                    results.forEach(function(result) {
                                        schema[result.TABLE_NAME].uniques[result.CONSTRAINT_NAME] = result.columnnames.split(',');
                                    });

                                    // récupère les cles étrangères
                                    connection.query(
                                        `SELECT k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, k.CONSTRAINT_NAME, cn.UPDATE_RULE, cn.DELETE_RULE
                        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS k
                        INNER JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS AS cn ON cn.CONSTRAINT_NAME = k.CONSTRAINT_NAME
                        WHERE REFERENCED_TABLE_SCHEMA = ` + connection.escape(config.mysql.database),
                                        function(err, results) {
                                            if (err) return callback(err);

                                            results.forEach(function(result) {
                                                schema[result.TABLE_NAME].columns[result.COLUMN_NAME].foreign = {};
                                                schema[result.TABLE_NAME].columns[result.COLUMN_NAME].foreign.name = result.CONSTRAINT_NAME;
                                                schema[result.TABLE_NAME].columns[result.COLUMN_NAME].foreign.table = result.REFERENCED_TABLE_NAME;
                                                schema[result.TABLE_NAME].columns[result.COLUMN_NAME].foreign.column =
                                                    result.REFERENCED_COLUMN_NAME;
                                                schema[result.TABLE_NAME].columns[result.COLUMN_NAME].foreign.delete = result.DELETE_RULE;
                                                schema[result.TABLE_NAME].columns[result.COLUMN_NAME].foreign.update = result.UPDATE_RULE;
                                            });

                                            // fait comme si la bdd est en text 65K au lieu de medium text 16M
                                            for (var table in schema) {
                                                for (var column in schema[table].columns) {
                                                    if (schema[table].columns[column].type == 'mediumtext') {
                                                        schema[table].columns[column].type = 'text';
                                                        schema[table].columns[column].maxlength = 65535;
                                                    }
                                                }
                                            }

                                            callback(null, schema);
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            );
        }
    );
}

function objToString(obj) {
    var sortable = [];
    for (var x in obj) {
        sortable.push([x, obj[x]]);
    }

    sortable.sort(function(a, b) {
        return a == b ? 0 : a > b ? 1 : -1;
    });

    return JSON.stringify(sortable);
}

function diffObject(obj1, obj2) {
    var s1 = objToString(obj1);
    var s2 = objToString(obj2);

    return s1 != s2;
}
