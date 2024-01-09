#!/usr/bin/env bash
set -euo pipefail

entryPoint=0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789
rpcUrl=
blockNum=
tmux=
signerKey=0x4337000000000000000000000000000000000000000000000000000000000000    # 0x21f386935c3937fA29C0682EF3Db9715dd832330
utilityKey=0x0000000000000000000000000000000000000000000000000000000000004337   # 0x68A726E5B0282fE2A7020E93aDeaBD68A2aa1dbe
anvilPort=8545
anvilHost=127.0.0.1
patchBytecode=()

projectRoot=`pwd | sed 's%\(.*/alto\)/.*%\1%'`

# helper functions.
usage(){
>&2 cat << EOF
Usage: $0 [OPTIONS]
Utility to spawn a local alto instances linked to an anvil node

Alto Options
   -e,  --entry-point       entryPoint contract address, 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789 (DEFAULT)

Anvil Options
   -r <rpc-url>             RPC url to fork from
   -b <block-num>           Fork block number
   -p <port>
   -h <host>
   -c <address>,<bytecode-file>

Misc Options
   -t                       Launch anvil + alto in a tmux split

EOF
exit 1
}
apply_bytecode_patches() {
    for patch in "${patchBytecode[@]}"; do
        IFS=',' read -r contractAddr bytecodeFile <<< "$patch"

        if [[ -z "$contractAddr" || -z "$bytecodeFile" ]]; then
            echo "ERR: wrong usage, failed to parse. correct usage: --replace-code <address>,<bytecode-file>"
            exit 1
        fi

        patchedBytecode=$(cat $bytecodeFile | tr -d '\n')

        curl -H "Content-Type: application/json" \
            -X POST --data "{\"id\": \"4337\", \"jsonrpc\":\"2.0\", \"method\":\"anvil_setCode\", \"params\": [\"$contractAddr\", \"$patchedBytecode\"]}" \
            $anvilHost:$anvilPort

    done
}
fund_accounts() {
    sleep 1.5s

    curl -s -H "Content-Type: application/json" \
         -X POST --data "{\"id\": \"4337\", \"jsonrpc\":\"2.0\", \"method\":\"anvil_setBalance\", \"params\": [\"$(cast wallet address $signerKey)\", \"3635C9ADC5DEA00000\"]}" \
         $anvilHost:$anvilPort > /dev/null

    curl -s -H "Content-Type: application/json" \
         -X POST --data "{\"id\": \"4337\", \"jsonrpc\":\"2.0\", \"method\":\"anvil_setBalance\", \"params\": [\"$(cast wallet address $utilityKey)\", \"3635C9ADC5DEA00000\"]}" \
         $anvilHost:$anvilPort > /dev/null
}

while getopts "e:r:b:h:p:c:t" opt;
do
  case ${opt} in
    e)
        entryPoint=$OPTARG
        ;;
    r)
        rpcUrl=$OPTARG
        ;;
    b)
        blockNum=$OPTARG
        ;;
    p)
        anvilPort=$OPTARG
        ;;
    h)
        anvilHost=$OPTARG
        ;;
    c)
        patchBytecode+=($OPTARG)
        ;;
    t)
        tmux=1
        ;;
  esac
done

# check for required flags.
isMissingFlag=0

[ -z $rpcUrl ] && echo "[NOTE] Flag -r (rpc url) Missing" && isMissingFlag=1
[ -z $blockNum ] && echo "[NOTE] Flag -b (block num) Missing" && isMissingFlag=1

if [ $isMissingFlag -eq 1 ]; then
  exit 1
fi

forkTimestamp=$(cast block $blockNum --rpc-url $rpcUrl | grep time | awk '{print $2}' | tr -d '\n')

# build alto intance.
pnpm build

if [ -z $tmux ]; then
    # launch both instances in same terminal.
    anvil --fork-url $rpcUrl \
          --fork-block-number $blockNum \
          --timestamp  $forkTimestamp &

    fund_accounts
    apply_bytecode_patches

    $projectRoot/alto --entryPoint $entryPoint \
                      --signerPrivateKeys $signerKey \
                      --utilityPrivateKey $utilityKey \
                      --rpcUrl http://$anvilHost:$anvilPort \
                      --minBalance 0 \
                      --disableExpirationCheck true \

    # check if the tmux session exists and nuke it if it does.
    SESSION="anvil_alto_session"
    if tmux has-session -t $SESSION 2>/dev/null; then
        tmux kill-session -t $SESSION
    fi

    # create tmux session
    tmux new-session -d -s $SESSION
    tmux split-window -h -t $SESSION

    # setup anvil on pane 0
    tmux send-keys -t ${SESSION}.0 "anvil --fork-url $rpcUrl \
                                          --fork-block-number $blockNum \
                                          --timestamp $forkTimestamp" C-m

    fund_accounts
    apply_bytecode_patches

    # setup alto on pane 1
    tmux send-keys -t ${SESSION}.1 "$projectRoot/alto --rpcUrl http://$anvilHost:$anvilPort \
                                                      --entryPoint $entryPoint \
                                                      --signerPrivateKeys $signerKey \
                                                      --utilityPrivateKey $utilityKey \
                                                      --minBalance 0" C-m \
                                                      --disableExpirationCheck true \

    tmux attach-session -t $SESSION
fi

exit 0
