const path = require("path");
const knexConfig = require('./knexfile');
const knex = require('knex')(knexConfig[process.env.NODE_ENV || "development"]);
const log = require('loglevel');
const { google } = require('googleapis');
const moment = require('moment');

const youtube = google.youtube("v3");

const JUSTINY_CHANNEL = "UCiTfB-A55Vq2fB610vaWJVA";
const RECHECK_DELAY = (process.env.RECHECK_DELAY !== undefined) ? process.env.RECHECK_DELAY : 604800; // 7 days is the default
const ERROR_RETRY_DELAY = (process.env.ERROR_RETRY_DELAY !== undefined) ? process.env.ERROR_RETRY_DELAY : 3600; // 1 hour is the default

let collectionUpdateRunning = false;

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
    log.debug(`Updating comment collection for ${remaining_ids.length} comments.`);

    if (remaining_ids.length == 0) return Promise.resolve(snippets);

    return youtube.comments.list({
        key: process.env.API_KEY,
        part: "snippet",
        id: remaining_ids.slice(0, 20).join(",")
    }).then(resp => {
        let fetched_ids = new Set();

        for(let comment of resp.data.items) {
            fetched_ids.add(comment.id);
            snippets[comment.id] = comment;
        }

        remaining_ids = remaining_ids.filter(id => !fetched_ids.has(id));
        
        if (fetched_ids.size == 0) {
            // skip all ids in this request and try the next one
            log.debug(`Comment reply was empty; trying next set of comments.`);
            return updateCommentCollection(remaining_ids.slice(20), snippets);
        } else {
            log.info(`Updated collection data for ${fetched_ids.size} comments.`);
            return updateCommentCollection(remaining_ids, snippets);
        }
        
    }, err => {
        log.error("[YouTube]", err.message);
        return snippets;
    });
}

function updateVideoCollection(remaining_ids, snippets = {}) {
    log.debug(`Updating video collection for ${remaining_ids.length} videos.`);

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
        
        if (fetched_ids.size == 0) {
            return Promise.resolve(snippets);
        } else {
            log.info(`Updated collection data for ${fetched_ids.size} videos.`);
            return updateVideoCollection(remaining_ids, snippets);
        }
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
                let last_checked = moment.utc(row.last_checked, "YYYY-MM-DD HH:mm:ss");

                if (moment.utc().diff(last_checked, "seconds") > RECHECK_DELAY) {
                    return checkVideo(video_id).then(comment_id => updateComment(video_id, comment_id));
                } else {
                    return null;
                }
            }
        }
    });
}

async function storeComment(video_id, comment_id) {
    await knex("sightings").insert({
        video_id,
        comment_id,
        first_detected: knex.fn.now()
    });
    
    return comment_id;
}

async function updateComment(video_id, comment_id) {
	await knex("sightings").where({ video_id }).update({
		comment_id, 
		last_checked: knex.fn.now(),
    });
    
    return comment_id;
}

async function fetchNewCommentContent() {
    log.debug("Fetching new comment contents...");

    let rows = await knex.select("sightings.video_id", "sightings.comment_id")
        .from("sightings")
        .leftJoin("video_data", "sightings.video_id", "video_data.video_id")
        .where("video_data.video_id", "is", null)
        .andWhere("video_data.comment_id", "is", null)
        .andWhere("sightings.comment_id", "is not", null);

    let video_ids = [], comment_ids = [], pairs = [];

    rows.forEach(row => {
        video_ids.push(row.video_id);
        comment_ids.push(row.comment_id);
        pairs.push([ row.video_id, row.comment_id ]);
    });

    let updated = 0;

    if (video_ids.length > 0 && comment_ids.length > 0) {
        // update database data from the youtube api
        let result = await updateCollection(video_ids, comment_ids);
        
        let commentSnippets = result[0];
        let videoSnippets = result[1];

        let insertionPromises = [];

        for (let pair of pairs) {
            if (videoSnippets[pair[0]] == undefined && commentSnippets[pair[1]] == undefined) {
                // completely remove entries which can not be fetched since the video has most likely been deleted
                log.debug(`Compltely removing sighting for video ${pair[0]} since it doesn't seem to exist anymore`);
                insertionPromises.push(knex("sightings").delete().where({
                    video_id: pair[0],
                }));

                continue;
            }

            updated++;

            if (videoSnippets[pair[0]] != undefined && commentSnippets[pair[1]] == undefined) {
                // comment is not fetchable -> insert empty entry so we dont try to fetch it again
                insertionPromises.push(knex("video_data").insert({
                    video_id: pair[0],
                    last_error: knex.fn.now(),
                    video_title: videoSnippets[pair[0]].snippet.title,
                    channel_name: videoSnippets[pair[0]].snippet.channelTitle,
                }));
            } else if (videoSnippets[pair[0]] == undefined && commentSnippets[pair[1]] != undefined) {
                // video is not fetchable -> insert empty entry so we dont try to fetch it again
                insertionPromises.push(knex("video_data").insert({
                    comment_id: pair[1],
                    last_error: knex.fn.now(),
                    comment_text: commentSnippets[pair[1]].snippet.textDisplay,
                    post_date: moment.utc(commentSnippets[pair[1]].snippet.publishedAt).format("YYYY-MM-DD HH:mm:ss"),
                }));
            } else {
                insertionPromises.push(knex("video_data").insert({
                    video_id: pair[0],
                    video_title: videoSnippets[pair[0]].snippet.title,
                    comment_id: pair[1],
                    comment_text: commentSnippets[pair[1]].snippet.textDisplay,
                    channel_name: videoSnippets[pair[0]].snippet.channelTitle,
                    post_date: moment.utc(commentSnippets[pair[1]].snippet.publishedAt).format("YYYY-MM-DD HH:mm:ss"),
                }));
            }
        }

        await Promise.all(insertionPromises);
    }

    return updated;
}

async function fetchErrorCommentContent() {
    log.debug("Fetching previously errored comment contents...");

    let rows = await knex.select("sightings.video_id as s_vid", 
                                 "sightings.comment_id as s_cid", 
                                 "video_data.video_id as v_vid", 
                                 "video_data.comment_id as v_cid", 
                                 "video_data.last_error",
                                 "video_data.id")
        .from("sightings")
        .leftJoin("video_data", "sightings.video_id", "video_data.video_id")
        .where("video_data.last_error", "is not", null);

    let video_ids = [], comment_ids = [], pairs = [];

    rows.forEach(row => {
        let last_error = moment.utc(row.last_error, "YYYY-MM-DD HH:mm:ss");

        if (moment.utc().diff(last_error, "seconds") > ERROR_RETRY_DELAY) {
            if (row.v_vid === null) {
                video_ids.push(row.s_vid);
            }
            if (row.v_cid == null) {
                comment_ids.push(row.s_cid);
            }
            pairs.push([ row.s_vid, row.s_cid, row.id ]);
        }
    });

    let updated = 0;

    if (pairs.length > 0) {
        // update database data from the youtube api
        let result = await updateCollection(video_ids, comment_ids);
        
        let commentSnippets = result[0];
        let videoSnippets = result[1];

        let updatePromises = [];

        for (let pair of pairs) {
            if (videoSnippets[pair[0]] == undefined && commentSnippets[pair[1]] == undefined) {
                updatePromises.push(knex("video_data").update({
                    last_error: knex.fn.now(),
                }).where({ id: pair[2] }));
            }

            if (videoSnippets[pair[0]] != undefined) {
                updatePromises.push(knex("video_data").update({
                    video_id: pair[0],
                    video_title: videoSnippets[pair[0]].snippet.title,
                    channel_name: videoSnippets[pair[0]].snippet.channelTitle,
                    last_error: null,
                }).where({ id: pair[2] }));
            }

            if (commentSnippets[pair[1]] != undefined) {
                updatePromises.push(knex("video_data").update({
                    comment_id: pair[1],
                    comment_text: commentSnippets[pair[1]].snippet.textDisplay,
                    post_date: moment.utc(commentSnippets[pair[1]].snippet.publishedAt).format("YYYY-MM-DD HH:mm:ss"),
                    last_error: null,
                }).where({ id: pair[2] }));
            }
        }

        await Promise.all(updatePromises);
    }
        
    return updated;
}

async function getCollection(order) {
    if (!collectionUpdateRunning) {
        collectionUpdateRunning = true;
        try {
            let updated = await fetchNewCommentContent();

            if (updated == 0) { // only take a crack at retrying the failed ones if we didn't load any new comments
                await fetchErrorCommentContent();
            }
        }
        finally {
            collectionUpdateRunning = false;
        }
    }

    let rows = await knex.select("video_data.video_id", 
                                 "video_data.comment_id", 
                                 "video_data.comment_text", 
                                 "video_data.channel_name", 
                                 "video_data.post_date", 
                                 "video_data.video_title",
                                 "sightings.first_detected")
                .from("video_data")
                .leftJoin("sightings", "sightings.video_id", "video_data.video_id")
                .where("video_data.comment_text", "is not", null)
                .andWhere("video_data.last_error", "is", null)
                .orderBy(order);

    let collection = [];

    rows.forEach(row => {
        collection.push({
            content: row.comment_text,
            video_id: row.video_id,
            comment_id: row.comment_id,
            video_title: row.video_title,
            channel_name: row.channel_name,
            date: moment(row.post_date, "YYYY-MM-DD HH:mm:ss").format("YYYY-MM-DD HH:mm"),
            first_detected: (row.first_detected !== null) ? moment(row.first_detected, "YYYY-MM-DD HH:mm:ss").format("YYYY-MM-DD") : null,
        });
    });

    return collection;
}

function getFullDBPath() {
    return path.resolve(knexConfig[process.env.NODE_ENV || "development"].connection.filename);
}

module.exports = {
    checkVideo,
    storeComment,
    updateComment,
    getCollection,
    checkDatabase,
    getFullDBPath,
};