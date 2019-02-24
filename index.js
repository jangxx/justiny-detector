require('dotenv').config();

const JUSTINY_CHANNEL = "UCiTfB-A55Vq2fB610vaWJVA";
const RECHECK_DELAY = (process.env.RECHECK_DELAY !== undefined) ? process.env.RECHECK_DELAY : 604800; // 7 days is the default

const knexConfig = require('./knexfile');

const path = require('path');

const express = require('express');
const log = require('loglevel');
const { google } = require('googleapis');
const knex = require('knex')(knexConfig[process.env.NODE_ENV || "development"]);
const moment = require('moment');

if (process.env.LOG != undefined) {
	log.setLevel(process.env.LOG);
}

const youtube = google.youtube("v3");
const app = express();

const videoidRE = /^[a-zA-Z0-9_-]{11}$/;

app.get("/api/check-and-retrieve", function(req, res) {
	let video_id = req.query.v;

	if (video_id == undefined) {
		return res.sendStatus(400);
	}

	if (!videoidRE.test(video_id)) {
		return res.sendStatus(400);
	}

	// check database if we've already seen this video_id
	knex.select("comment_id", "last_checked").from("sightings").where({ video_id }).then(rows => {
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
	}).then(comment_id => {
		return res.json({
			comment_id,
			video_id
		});
	}).catch(err => {
		log.error(err.message);
		return res.sendStatus(500);
	});
});

app.get("/", function(req, res) {
	res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(process.env.PORT, process.env.ADDRESS, () => {
	log.info(`Server is listening on ${process.env.ADDRESS}:${process.env.PORT}`);
});

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
	})
}

function storeComment(video_id, comment_id) {
	return knex("sightings").insert({ video_id, comment_id }).then(() => comment_id);
}

function updateComment(video_id, comment_id) {
	return knex("sighting").where({ video_id }).update({
		comment_id, 
		last_checked: moment().utc().format("YYYY-MM-DD HH:mm:ss") 
	}).then(() => comment_id);
}