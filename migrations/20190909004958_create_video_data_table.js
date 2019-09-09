
exports.up = function(knex) {
    return knex.schema.createTable("video_data", table => {
		table.increments("id");
        table.string("video_id", 12);
        table.string("comment_id", 40);
        table.text("comment_text");
        table.text("channel_name");
		table.datetime("post_date");

		table.index("video_id");
	});
};

exports.down = function(knex) {
    return knex.schema.dropTable("video_data");
};
