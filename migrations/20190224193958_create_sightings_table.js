
exports.up = function(knex, Promise) {
	return knex.schema.createTable("sightings", table => {
		table.increments("id");
		table.string("video_id", 12);
		table.string("comment_id", 40);
		table.datetime("last_checked").defaultTo(knex.fn.now());

		table.index("video_id");
	});
};

exports.down = function(knex, Promise) {
	return knex.schema.dropTable("sightings");
};
