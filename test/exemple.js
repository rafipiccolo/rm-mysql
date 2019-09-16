var Model = require('../index.js');
var model = new Model({
    mysql: {
        host: 'localhost',
        user: 'root',
        password: 'root',
        database: 'root',
        port: 3307
    },
    schema: {

    },
    logger: console,
});

model.query('select 2', function(err, data){
    if (err) console.log('err', err);
    
    console.log(data);
});
