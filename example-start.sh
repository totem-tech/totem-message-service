# git pull && git submodule sync && git submodule update --init --recursive --remote && \
# _______________DYNAMIC_VARIABLES_BELOW_______________="Changes to variables below DO NOT REQUIRE server restart" \
# keyData="string: (96 bytes hex without 0x) exactly as found in the oo7-substrate's secretStore" \
# serverName="string: a secret name for the server" \
# external_serverName="string: faucet server's name" \
# external_publicKey="string: (base64-encoded) 32 byte encryption public key from the faucet server" \
# printSensitiveData="string: enable or disable printing of keypair and other sensitive data. To Enable set value to 'YES' (case-sensitive)" \
# _______________STATIC_VARIABLES_BELOW_______________="Changes to below variables DO REQUIRE server restart" \
# FAUCET_SERVER_URL="string: https://hostname:port" \
# STORAGE_PATH="string: ./relative/or/absolute/directory/path/where/server/data/is/stored" \
# CertPath="./sslcert/fullchain.pem" \
# KeyPath="./sslcert/privkey.pem" \
# PORT="int 3001" \
# BuildMode="string: TRUE" \ #indicates whether to allow frontend to be able to grab all error messages at once
# CouchDB_URL="string: https://adminId:password@127.0.0.1:5984" \ # CouchDB URL and admin credentials (if available) to establish a connection 
# CouchDB_URL_[DBNAME]="string: (optional) define database specific connection URL. Replace ![DBNAME]! with the name of the database. Caution: THIS IS A VARIABLE-ENVIRONEMNT VARIABLE." \
# _NOTES_="DBName override required due to change of database name in the collection" \
# CouchDB_DBName_Override_currencies_price_history_daily="currencies_price-history-daily" \
# CouchDB_DBName_Override_gl_accounts="gl-accounts" \
# CouchDB_DBName_Override_newsletter_signup="newsletter-signup" \
# CouchDB_DBName_Override_faucet_requests="faucet-requests" \
# MigrateFiles="string: comma-separated JSON filenames" \ # migrate JSON storage to CouchDB storage
# DISCORD_WEBHOOK_URL="string: URL of the Discord channel webhook. https://url-fo-the-discord-webhook" \
# DISCORD_WEBHOOK_AVATAR_URL="string: URL to the avatar image. Eg: https://url-to-avatar-image" \
# DISCORD_WEBHOOK_USERNAME="string: name for the webhook. Eg: `dev.totem.live`" \
# DISCORD_WEBHOOK_URL_SUPPORT="string: URL of the Discord channel webhook to forward all support messages from the website" \
# Debug="Boolean: use true enable verbose debugging" \
# ProcessMissedPayouts="string: use YES to enable processing missed payouts on startup" \
# Twitter_Bearer_Token="string: token for accessing Twitter API" \
# SOCKET_CLIENTS="string: (optional) URL of the web applications to allow connecting to the messaging service. Example: 'https://totem.live,https//:some-other-app.com'" \
# SignupRewardsDisabled="string: (optional) YES/NO" \
# ReferralRewardsDisabled="string: (optional) YES/NO" \
# SocialRewardsDisabled="string: (optional) YES/NO" \
# ReprocessRewards="string: (optional) YES/NO" \
# ReprocessTwitterRewards="string: (optional) YES/NO" \
# yarn run dev