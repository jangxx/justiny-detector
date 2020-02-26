require('dotenv').config();

const path = require('path');

const express = require('express');
const log = require('loglevel');
const urlParser = require('js-video-url-parser');

const { getCollection, checkDatabase } = require('./db');
const videoidRE = /^[a-zA-Z0-9_-]{11}$/;

if (process.env.LOG != undefined) {
	log.setLevel(process.env.LOG);
}

const app = express();
app.set('view engine', 'ejs');

app.use("/assets", express.static(path.join(__dirname, "assets")));

app.get("/api/check-and-retrieve", function(req, res) {
	let video_id = req.query.v;

	if (video_id == undefined) {
		return res.sendStatus(400);
	}

	if (!videoidRE.test(video_id)) {
		return res.sendStatus(400);
	}

	// check database if we've already seen this video_id
	checkDatabase(video_id).then(comment_id => {
		return res.json({
			comment_id,
			video_id
		});
	}).catch(err => {
		log.error(err.message);
		return res.sendStatus(500);
	});
});

app.get("/api/parse-url", function(req, res) {
	let url = req.query.url;

	if (url == undefined || url == "") {
		return res.sendStatus(400);
	}

	let parseResult = urlParser.parse(url);

	if (parseResult.mediaType != "video" || parseResult.provider != "youtube") {
		return res.sendStatus(404);
	}

	return res.json({ video_id: parseResult.id });
});

app.get("/", function(req, res) {
	res.render('index', { trackingCode: process.env.TRACKING_CODE_FILE });
});

app.get("/collection", function(req, res) {
	let orderDirection = "desc";

	if ([ "desc", "asc", "recent" ].includes(req.query.order)) {
		orderDirection = req.query.order;
	}

	let order = [{ column: "post_date", order: "desc" }];

	switch(orderDirection) {
		case "asc":
			order = [{ column: "post_date", order: "asc" }];
			break;
		case "recent":
			order = [{ column: "first_detected", order: "desc" }, { column: "post_date", order: "desc" }];
			break;
	}

	getCollection(order).then(collection => {
		res.render("collection", {
			comments: collection, 
			orderDirection,
			trackingCode: process.env.TRACKING_CODE_FILE
		});
	}).catch(err => {
		log.error("[collection]", err.message);
		res.render("collection", {
			comments: [], 
			orderDirection,
			trackingCode: process.env.TRACKING_CODE_FILE
		});
	});
});

app.listen(process.env.PORT, process.env.ADDRESS, () => {
	log.info(`Server is listening on ${process.env.ADDRESS}:${process.env.PORT}`);
});