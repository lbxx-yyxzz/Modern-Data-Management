#!/bin/sh
set -eu

export SURVEY_APP_PASSWORD="$(cat "$MONGO_APP_PASSWORD_FILE")"
mongosh --quiet --host 127.0.0.1 --port 27017 "$MONGO_INITDB_DATABASE" --eval '
  db.createUser({
    user: "survey_app",
    pwd: process.env.SURVEY_APP_PASSWORD,
    roles: [{ role: "readWrite", db: db.getName() }]
  });
'
unset SURVEY_APP_PASSWORD
