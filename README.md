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
- `TRACKING_CODE_FILE`  
[optional] Specify the path of a file containing some additional text/code to be included in the header. The path can either be absolute, or relative to the *views/* directory.

After you have set your environment variables install the `knex` cli:

	npm i -g knex

and run

	knex migrate:latest --env production

to initialize the database.

## Running

If you have installed everything, simply run

	node ./

to start the server.

## Update

You can simply pull this repo to get all the updated features.
Afterwards you need to run

	knex migrate:latest --env production

again, to update the database with new/changed tables.