NODE_OPTIONS="--max-old-space-size=8192" \
DBName="string" \
CouchDB_URL="string: URL with username and password to access CouchDB. Eg: http://username:password@127.0.0.1:5984" \
FILENAME="string: name of the output file" \
LIMIT="integer: number of items to retrieve" \
SKIP="integer: number of items to skip" \
STORAGE_PATH="string: path to the JSON file storage directory" \
yarn run tools-export
