module.exports = {
    user: {
        columns: {
            id: { nullable: false, type: 'int', autoincrement: true, primary: true },
            name: { nullable: true, type: 'varchar', maxlength: 255 },
            referentId: {
                nullable: true,
                type: 'int',
                foreign: {
                    name: 'user_referent',
                    table: 'user',
                    column: 'id',
                    delete: 'SET NULL',
                    update: 'CASCADE',
                },
            },
        },
        comment: '',
    }
}
