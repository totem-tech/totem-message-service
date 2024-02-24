NODE_OPTIONS="--max-old-space-size=8192" \
CDP_KEY_DATA="Encoded hex string to generate keypairs" \
CouchDB_URL="http://user:password@host:port" \
_CouchDB_DBName_Override_companies="z_dev_companies" \
_CouchDB_DBName_Override_cdp_access_codes="z_dev_cdp_access-codes" \
CSV_FILE_PATH="path/to/file.csv" \
SCRIPT="importCDPAccessCodes" \
yarn run tools-script
