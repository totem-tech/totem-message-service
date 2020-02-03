# Totem Messaging Server

This repo is the code for a centralised messaging service that routes messages to peers (users) on the network. This is not ideal in a decentralsied world, but for now there are no good or production ready decentralised alternatives.

It is also used to execute transaction requests to the automated Totem faucet which you can find details of below. This server is therefore currently _dependent_ on there being a faucet server.  


This service will gradually be enhanced over time to include:

* a NoSQL database (to replace the current use of JSON files which is a legacy of the PoC)

* user authentication using the Totem BONSAI protocol

* a P2P wrapper around the database to allow the storage service to be distributed to other parties

* long term evolution into a full p2p database and messaging service 

## Installation 

Simple steps as follows:

### Dependencies

This server installation depends on `Node.js` and `Yarn`package manager.

Install the dependencies first:

https://nodejs.org/en/download/package-manager/

https://yarnpkg.com/getting-started/install

Clone the repo:

```shell 
mkdir message 
cd message
git clone https://gitlab.com/totem-tech/totem-message-service.git
cd totem-message-service

yarn install
````

The server currently employs Polkadot.js, and therefore needs to always run with the most up-to-date type declarations. This is done through setting up git submodules - however be warned - once the server is running, it will lose syncronisation with this definitions file unless it is restarted from time-to-time. 

Install the submodule as follows:

```shell

cd totem-message-service
git config --file=.gitmodules submodule.src/utils.url https://gitlab.com/totem-tech/common-utils.git
git config --file=.gitmodules submodule.src/utils.branch dev
git submodule sync
git submodule update --init --recursive --remote

````

You will then need to confgure the environmental variables. You can find an example of the variables you need, in the example-start.sh file. 

Please be aware that it is not good practice to store your certificates in the `sslcert` directory, this is for self-signed certificates in a dev environment only.

You can also get help on the use of the environmental variables from the Faucet repo [ReadMe](https://gitlab.com/totem-tech/faucet/blob/master/ReadMe.md)

## Execution
Once configured you can store the start script in the root of the server, and execute like this: 

```shell 
./start.sh 
```

You might also want to consider adding an `@reboot` command to `crontab` in case of server failure.

