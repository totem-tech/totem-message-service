NODE_OPTIONS="--max-old-space-size=8192" \
filepath="${1:-}" \
startingNumber="1" \
seed="//Alice${2:-}" \
DBName="companies_test" \
CouchDB_URL="http://admin:123456@127.0.0.1:5984" \
CouchDB_BulkSize="10" \
yarn run tools-company
