
exports.up = function(knex) {
    return Promise.all([
        knex.schema.table("sightings", table => {
            table.datetime("first_detected", null);
        }),
        knex.schema.table("video_data", table => {
            table.datetime("last_error", null);
        }),
    ]);
};

exports.down = function(knex) {
    return Promise.all([
        knex.schema.table("sightings", table => {
            table.dropColumn("first_detected");
        }),
        knex.schema.table("video_data", table => {
            table.dropColumn("last_error");
        }),
    ]);
};
