require('dotenv').config();

const knexConfig = require('./knexfile');

const express = require('express');
const log = require('loglevel');
const knex = require('knex')(knexConfig[process.env.NODE_ENV]);

if (process.env.LOG != undefined) {
	log.setLevel(process.env.LOG);
}

const app = express();

app.listen(process.env.PORT, process.env.ADDRESS, () => {
	log.info(`Server is listening on ${process.env.ADDRESS}:${process.env.PORT}`);
});