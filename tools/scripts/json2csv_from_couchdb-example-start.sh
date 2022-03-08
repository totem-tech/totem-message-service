NODE_OPTIONS="--max-old-space-size=8192" \
SCRIPT="../export-db,json2csv" \
___CSV_RELATED_ENV____="" \
FILEPATH_CSV_OPTIONS="string: (optional) options JSON file path. See https://www.npmjs.com/package/json2csv" \
FILEPATH_CSV_OUTPUT="string: output file path " \
___CouchDB_related_env="" \
DBName="string" \
CouchDB_URL="string: URL with username and password to access CouchDB. Eg: http://username:password@127.0.0.1:5984" \
LIMIT="integer: number of items to retrieve" \
SKIP="integer: number of items to skip" \
___Shared_ENV______="" \
FILENAME="string: name of the CouchDB output file which is also the input file for CSV export" \
STORAGE_PATH="string: (optional) path to the DataStorage directory" \
yarn run tools-script