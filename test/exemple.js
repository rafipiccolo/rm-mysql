var config = require('./config.js');
var Model = require('../index.js');
var model = new Model(config);

model.query('select 2', function(err, data){
    if (err) console.log('err', err);
    
    console.log(data);
});
