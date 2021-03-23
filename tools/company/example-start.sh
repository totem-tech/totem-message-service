NODE_OPTIONS="--max-old-space-size=8192" \
filepath="string: path to .csv file. Hard code it here or use following to enter as a command argument: ${1}" \
startingNumber="int: seed derivation starting number. Hard code it here or use following to enter as a command argument: ${2}" \
seed="string: Seed used to generate addresses for each company. Following derivation will be appended: /1/{incremental-number-starting-from-@startingNumber}" \
DBName="companies" \
CouchDB_URL="string: URL with username and password to access CouchDB. Eg: http://username:password@127.0.0.1:5984" \
CouchDB_BulkSize="int: number of items to group together to bulk-save to CouchDB. Recommended: between 10 and 100" \
STORAGE_PATH="./data" \
yarn run tools-company
