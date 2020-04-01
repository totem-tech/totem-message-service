# For development:

```bash
cd sslcert
openssl req -new -newkey rsa:4096 -nodes -keyout totem.key -out totem.csr
openssl x509 -req -sha256 -days 365 -in totem.csr -signkey totem.key -out fullchain.pem
mv totem.key privkey.pem
rm totem.csr
```

To get around permission denied issue: 
```bash
sudo apt-get install libcap2-bin
sudo setcap cap_net_bind_service=+ep `readlink -f \`which node\``
```

# Start server with CouchDB:

1. Install docker (follow instructions on docker website)

2. Pull  CouchDB official docker image:
docker pull couchdb:3.0.0

3. Create a docker container:
```
docker run \
--net=host \
-d --name totem-couchdb \
-e COUCHDB_USER=admin \
-e COUCHDB_PASSWORD=123456 \
-v /home/couchdb/data:/opt/couchdb/data \
couchdb:3.0.0
```
- Change username and use a more secure password
- Change `/home/couchdb/data` with the location of the CouchDB storage directory so that data remains persistent regardless of the docker container.Make sure CouchDB has read-write permission.
- For **Mac OS** users: change `--net=host` with `-p 5984:5984` if you get an error because of host networking.

4. Create/update `start.sh` to include two more environment variables (see `example-start.sh` for a full list of accepted/required variables):

    a. CouchDB URL and credentials (as set in the step 3):
    
    ```
    CouchDB_URL="http://admin:123456@127.0.0.1:5984" \
    ```

    b. Migrate existing JSON files by putting all the desired JSON file names separated by comma:

    ```
    MigrateFiles="companies.json,countries.json,faucet-requests.json,notification-receivers.json,notifications.json,projects.json,translations.json,users.json" \
    ```

  - any data that is migrated will be removed from the JSON file. After first time 
  migration all JSON files will become empty with "[]" brackets.
  - as long as `MigrateFile` variable exists in the start script, every time the application is started, it will attempt to migrate the data files specified
  - existing data will never be overridden with the exception of:
    - translations.json

5. Run the start.sh file to start the application

If you choose not to use docker you will have to setup CouchDB manually which will probably require more steps. You just have to **skip to step 4** and everything will work just the same as long as the URL and credentials are correct and accessible by the messaging service.

To access CouchDB admin panel interface using a browser, visit: **http://127.0.0.1:5984/_utils/** (change IP and port if required).