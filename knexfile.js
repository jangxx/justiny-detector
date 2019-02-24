// Update with your config settings.
require('dotenv').config();

module.exports = {

  development: {
    client: 'sqlite3',
    connection: {
      filename: './dev.sqlite3'
    },
    useNullAsDefault: true
  },

  production: {
    client: 'sqlite3',
    connection: {
      filename: process.env.SQLITE_PATH
    },
    useNullAsDefault: true
  }

};
