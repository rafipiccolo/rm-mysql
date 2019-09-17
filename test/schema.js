module.exports = {
    user: {
        columns: {
            id: { nullable: false, type: 'int', autoincrement: true, primary: true },
            name: { nullable: true, type: 'varchar', maxlength: 255 },
        },
        comment: '',
    }
};
