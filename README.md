# Justin Y. Detector

Server software which searches YouTube comments for Justin Y. and stores the result for cached access.

## Installation

Clone the repository and run

	npm install

Afterwards create a file called `.env` where you need to define the following environment variables:

- `NODE_ENV`  
Set this to `"production"`.
- `SQLITE_PATH`  
Path where you want the sqlite database to be placed
- `API_KEY`  
API key from the [google API console](https://console.cloud.google.com)
- `PORT`  
Port to bind the webserver to

- `ADDRESS`  
[optional] Address to bind the webserver to (Default: `""`, which means all addresses)
- `LOG`  
[optional] Set the loglevel (See the [loglevel docs](https://www.npmjs.com/package/loglevel) for allowed values) (Default: `"error"`)
- `RECHECK_DELAY`  
[optional] Number of seconds after which a video is queried again if no comment could be found the last time. (Default: 604800)

After you have set your environment variables install the `knex` cli:

	npm i -g knex

and run

	knex migrate:latest --env production

to initialize the database.

## Running

If you have installed everything, simply run

	node ./

to start the server.