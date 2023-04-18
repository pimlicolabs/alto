#!/bin/bash  -e
# launch bundler: also start anvil, and deploy entrypoint.
cd `dirname $0`

ANVIL=anvil
ANVILPORT=8545
BUNDLERPORT=3000
ANVILPID=/tmp/alto.anvil.pid
BUNDLERPID=/tmp/alto.node.pid
VERSION="alto-0.0.1"

BUNDLERLOG=/tmp/alto.log

BUNDLERURL=http://localhost:$BUNDLERPORT/rpc
NODEURL=http://localhost:$ANVILPORT

function fatal {
  echo "$@" 1>&2
  exit 1
}

function isPortFree {
  port=$1
  curl http://localhost:$port 2>&1 | grep -q "Couldn't connect to server"
}


function waitForPort {
  port=$1
  while isPortFree $port; do true; done
}

function startBundler {
  isPortFree $ANVILPORT || fatal port $ANVILPORT not free
  isPortFree $BUNDLERPORT || fatal port $BUNDLERPORT not free

  echo == starting anvil 1>&2
  $ANVIL --version | 1>&2

  $ANVIL & echo $! > $ANVILPID

  waitForPort $ANVILPORT

  echo == Deploying entrypoint 1>&2
  export TS_NODE_TRANSPILE_ONLY=1
  yarn ts-node test/deployEntryPoint.ts
  echo == Starting bundler 1>&2
  ./alto run --config ./config.localhost.json & echo $! > $BUNDLERPID
  waitForPort $BUNDLERPORT
}

function start {
  isPortFree $ANVILPORTPORT || fatal port $ANVILPORT not free
  isPortFree $BUNDLERPORT || fatal port $BUNDLERPORT not free
  startBundler > $BUNDLERLOG
  echo == Bundler, Anvil started. log to $BUNDLERLOG
}

function stop {
  echo == stopping bundler
  test -r $BUNDLERPID && kill -9 `cat $BUNDLERPID`
  test -r $ANVILPID && kill -9 `cat $ANVILPID`
  rm $BUNDLERPID $ANVILPID
  echo == bundler, anvil stopped
}

function jsoncurl {
  method=$1
  params=$2
  url=$3
  data="{\"method\":\"$method\",\"params\":$params,\"id\":1,\"jsonrpc\":\"2.0\"}"
  curl -s -H content-type:application/json -d $data $url
}

function info {
  entrypoint=`jsoncurl eth_supportedEntryPoints [] $BUNDLERURL | jq -r .result["0"]`
  echo "BUNDLER_ENTRYPOINT=$entrypoint"
  status="down"; test -n "$entrypoint" && status="active"
  echo "BUNDLER_URL=$BUNDLERURL"
  echo "BUNDLER_NODE_URL=$NODEURL"
  echo "BUNDLER_LOG=$BUNDLERLOG"
  echo "BUNDLER_VERSION=$VERSION"
  echo "BUNDLER_STATUS=$status"
}

case $1 in

 start)
	start
	;;
 stop)
 	stop
	;;

  restart)
	echo == restarting bundler
	stop
	start
	;;

  info)
    info
    ;;

 *) echo "usage: $0 {start|stop|restart|info}"
    exit 1 ;;


esac