#!/bin/bash 
rpcurl=$1
timeout=${2:-10}

if [ -z "$rpcurl" ]; then
echo $0 {rpcurl} [timeout]
exit 2
fi

for ((i=0; i<$timeout; i++ )); do

  resp=`curl $rpcurl -s -H "content-type: application/json" -d '{"jsonrpc":"2.0", "id":1, "method":"eth_chainId", "params":[]}'`
  echo $resp | jq 'if .result then true else false end' | grep -q 'true' && exit 0
  sleep 1

done
echo Timed-out waiting for $rpcurl
exit 1
