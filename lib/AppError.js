'use strict';

module.exports = class AppError extends Error {
    constructor(code, message, obj) {
        super(message);
        Error.captureStackTrace(this, AppError);
        this.name = 'Error';
        this.code = code;
        for (var i in obj) this[i] = obj[i];
    }
};
