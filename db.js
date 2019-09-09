const knexConfig = require('./knexfile');
const knex = require('knex')(knexConfig[process.env.NODE_ENV || "development"]);
const log = require('loglevel');
const { google } = require('googleapis');
const moment = require('moment');

const youtube = google.youtube("v3");

const JUSTINY_CHANNEL = "UCiTfB-A55Vq2fB610vaWJVA";
const RECHECK_DELAY = (process.env.RECHECK_DELAY !== undefined) ? process.env.RECHECK_DELAY : 604800; // 7 days is the default

function checkVideo(id) {
	log.info(`Checking YouTube API for video ${id}`);

	return youtube.commentThreads.list({
		key: process.env.API_KEY,
		part: "snippet",
		videoId: id,
		searchTerms: "Justin Y.",
		maxResults: 100
	}).then(resp => {
		let comments = resp.data.items;

		for(let comment of comments) {
			// check if the comment author matches Justin Y.
			let author = comment.snippet.topLevelComment.snippet.authorChannelId.value;

			if (author == JUSTINY_CHANNEL) {
				return comment.id;
			}
		}

		return null;
	}).catch(err => {
		log.error("[YouTube]", err.message);
		return null; // store the null result in db so we don't recheck the same invalid urls over and over again
	});
}

function updateCollection(video_ids, comment_ids) {
    return Promise.all([
        updateCommentCollection(comment_ids),
        updateVideoCollection(video_ids),
    ]);
}

function updateCommentCollection(remaining_ids, snippets = {}) {
    if (remaining_ids.length == 0) return Promise.resolve(snippets);

    return youtube.comments.list({
        key: process.env.API_KEY,
        part: "snippet",
        id: remaining_ids.slice(0, 50).join(",")
    }).then(resp => {
        let fetched_ids = new Set();
        for(let comment of resp.data.items) {
            fetched_ids.add(comment.id);
            snippets[comment.id] = comment;
        }

        remaining_ids = remaining_ids.filter(id => !fetched_ids.has(id));

        log.info(`Updated collection data for ${fetched_ids.size} comments.`);
        return updateCommentCollection(remaining_ids, snippets);
    }, err => {
        log.error("[YouTube]", err.message);
        return snippets;
    });
}

function updateVideoCollection(remaining_ids, snippets = {}) {
    if (remaining_ids.length == 0) return Promise.resolve(snippets);

    return youtube.videos.list({
        key: process.env.API_KEY,
        part: "snippet",
        id: remaining_ids.slice(0, 50).join(",")
    }).then(resp => {
        let fetched_ids = new Set();
        for(let video of resp.data.items) {
            fetched_ids.add(video.id);
            snippets[video.id] = video;
        }

        remaining_ids = remaining_ids.filter(id => !fetched_ids.has(id));

        log.info(`Updated collection data for ${fetched_ids.size} videos.`);
        return updateVideoCollection(remaining_ids, snippets);
    }, err => {
        log.error("[YouTube]", err.message);
        return snippets;
    });
}


function checkDatabase(video_id) {
    return knex.select("comment_id", "last_checked").from("sightings").where({ video_id }).then(rows => {
        if (rows.length == 0) {
            return checkVideo(video_id).then(comment_id => storeComment(video_id, comment_id));
        } else {
            let row = rows[0];

            if (row.comment_id !== null) {
                return row.comment_id;
            } else {
                // see when we have last checked this video and check again if the time is right
                let last_checked = moment(row.last_checked, "YYYY-MM-DD HH:mm:ss");

                if (moment().utc().diff(last_checked, "seconds") > RECHECK_DELAY) {
                    return checkVideo(video_id).then(comment_id => updateComment(video_id, comment_id));
                } else {
                    return null;
                }
            }
        }
    });
}

function storeComment(video_id, comment_id) {
	return knex("sightings").insert({ video_id, comment_id }).then(() => comment_id);
}

function updateComment(video_id, comment_id) {
	return knex("sightings").where({ video_id }).update({
		comment_id, 
		last_checked: moment().utc().format("YYYY-MM-DD HH:mm:ss") 
	}).then(() => comment_id);
}

function getCollection() {
    // get videos which we have not updated yet
    return knex.select("sightings.video_id", "sightings.comment_id").from("sightings").leftJoin("video_data").where("video_data.video_id", "is", null).andWhere("sightings.comment_id", "is not", null).then(rows => {
        let video_ids = [], comment_ids = [], pairs = [];

        rows.forEach(row => {
            video_ids.push(row.video_id);
            comment_ids.push(row.comment_id);
            pairs.push([ row.video_id, row.comment_id ]);
        });

        return { video_ids, comment_ids, pairs };
    }).then(({ video_ids, comment_ids, pairs }) => {
        if (video_ids.length > 0 && comment_ids.length > 0) {
            // update database data from the youtube api
            return updateCollection(video_ids, comment_ids).then(result => {
                let commentSnippets = result[0];
                let videoSnippets = result[1];

                if (Object.keys(videoSnippets).length != Object.keys(commentSnippets).length) {
                    return;
                }

                let insertionPromises = [];

                for (let pair of pairs) {
                    insertionPromises.push(knex("video_data").insert({
                        video_id: pair[0],
                        comment_id: pair[1],
                        comment_text: commentSnippets[pair[1]].snippet.textOriginal,
                        channel_name: videoSnippets[pair[0]].snippet.channelTitle,
                        post_date: moment(commentSnippets[pair[1]].snippet.publishedAt).utc().format("YYYY-MM-DD HH:mm:ss") 
                    }));
                }

                return Promise.all(insertionPromises);
            });
        }
    });
}

module.exports = {
    checkVideo,
    storeComment,
    updateComment,
    getCollection,
    checkDatabase
};