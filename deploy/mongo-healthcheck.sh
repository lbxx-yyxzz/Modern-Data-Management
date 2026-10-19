#!/bin/sh
set -eu

PASSWORD="$(cat /run/secrets/mongo_root_password)"
mongosh --quiet --host 127.0.0.1 --port 27017 \
  --username survey_root --password "$PASSWORD" --authenticationDatabase admin \
  --eval 'db.adminCommand({ ping: 1 }).ok' | grep -q '^1$'
