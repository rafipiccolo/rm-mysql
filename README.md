# Description

Extends mysql npm's package and provide a cli for database schema diff and updating

# Install

	$> npm -g install rm-mysql

# Usage

    var config = require('./config.js');
    var Model = require('rm-mysql');
    var model = new Model(config);

# config & cli

Create a config.js file at the root of the project with a mysql field containing the connection configuration :

    $> emacs config.js
    module.exports = {
        mysql: {
            host: 'xxx',
            user: 'xxx',
            database: 'xxx_xxx',
            password: 'xxx',
            charset: 'utf8mb4',
            /* use any config supported by npm mysql */
        },
        logger: console,
        schema: require('./schema.js'),
    }

create a schema file

    $> emacs schema.js
    module.exports = {
        user: {
            columns: {
                id: { nullable: false, type: 'int', autoincrement: true, primary: true },
                enable: { nullable: false, type: 'tinyint', default: '0' },
                name: { nullable: false, type: 'varchar', maxlength: 50, collation: 'utf8mb4_general_ci' },
                email: { nullable: false, type: 'varchar', maxlength: 50, collation: 'utf8mb4_general_ci' },
                password: { nullable: false, type: 'varchar', maxlength: 50, collation: 'utf8mb4_general_ci' },
                groupId: {
                    nullable: true,
                    type: 'int',
                    foreign: {
                        name: 'user_group',
                        table: 'group',
                        column: 'id',
                        delete: 'CASCADE',
                        update: 'CASCADE',
                    },
                },
                updatedAt: { nullable: false, type: 'datetime' },
                createdAt: { nullable: false, type: 'datetime' },
            },
            uniques: {
                uniqueEmail: ['email'],
            },
            comment: "user table contains all data of the user",
        },
        group: {
            columns: {
                id: { nullable: false, type: 'int', autoincrement: true, primary: true },
                name: { nullable: false, type: 'varchar', maxlength: 50, collation: 'utf8mb4_general_ci' },
                updatedAt: { nullable: false, type: 'datetime' },
                createdAt: { nullable: false, type: 'datetime' },
            },
            comment: "group table",
        },
    }

Will generate the proper "create / alter table" to update database to match schema.js 

    $> modeltools update

Will do the opposite. Generate a schema from the database schema 

    $> modeltools update

Execute custom sql on database

    $> modeltools exec "select 1"

See more commands by typings

    $> modeltools

## query

    model.query('select 1 as x', function(err, data) {
        // data : [{x: 1}]
    });

    model.queryOne('select 1 as x', function(err, data) {
        // data : {x: 1}
    });

    model.queryNb('select 1 as x', function(err, data) {
        // data : 1
    });

## escape

escape a single value

    model.escape('a')
    // 'a'

escape multiple ids : ensures all given ids are integers (for use in IN clause for exemple) :

    model.escapeIds('1,2,3')
    // 1,2,3

clean an object according to database schema. will sanitize fields for a safe insert/update and removes fields that do not exist in database.

    var cleanObject = model.clean(object)

## insert

data is autoescaped according to model schema.
The generated id is returned automatically

    model.insert('user', {
        name: 'test',
        age: 12
    }, function(err, data){
        /*
        data : {
            id: 1,
            name: 'test',
            age: 12,
        }
        */
    })

    insertIgnore('user', object, callback);
    insertMulti('user', arrayOfObjects, callback);

## update

In the user table, the id is a primary key, therefore it will generate "where id = 1" and update the name

    model.update('user', {
        id: 1,
        name: 'newname',
    }, function(err, data){
    })

if the key already exists update instead of inserting

    model.insertOrUpdate('user', object, callback);

## delete

    model.delete('user', 1, callback)

## generating where clause

    var where = [];
    where.push('name like '%test%')
    where.push('age > 20')
    model.query('select * from user ${model.where(where)}')

## generating order by

    var orderBy = {id: 'ASC'};
    model.query('select * from user ${model.orderBy(orderBy)}')

# closing connections

    model.end();

# log format

This package calls the logger in that way :

logger[level](key, message, obj, callback);

* level : can be info, error, warn
* key : the package name
* message : blablabla
* obj (optional) : additional data in an object
* callback (optional) : called when the data is logged

# test

In a terminal

    cd test
    docker-compose up

In another

    cd test
    node ../modeltools.js create
    node ../modeltools.js update
    mocha
