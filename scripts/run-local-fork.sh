#!/usr/bin/env bash
set -euo pipefail

entryPoint=0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789
rpcUrl=
blockNum=
tmux=
signerKey=0x4337000000000000000000000000000000000000000000000000000000000000    # 0x21f386935c3937fA29C0682EF3Db9715dd832330
utilityKey=0x0000000000000000000000000000000000000000000000000000000000004337   # 0x68A726E5B0282fE2A7020E93aDeaBD68A2aa1dbe
timestamp=$(date +%s)
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
   -r,  --rpc-url           RPC url to fork from
   -b,  --block-num         Fork block number
   -t,  --timestamp
   -p,  --port
   -h,  --host              IP Address
   -c,  --replace-code      Replace an addresses bytecode, usage: <address>,<bytecode-file>

Misc Options
   --help
   --tmux                   Launch anvil + alto in a tmux split

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

args=$(getopt -a -o e:r:b:p:t:c:h --long entry-point:,rpc-url:,block-num:,timestamp:,port:,host:,replace-code:,tmux,help -- "$@")
if [[ $? -gt 0 ]]; then
  usage
fi

eval set -- ${args}
while :
do
  case $1 in
    -e | --entry-point)             entryPoint=$2;              shift 2 ;;
    -r | --rpc-url)                 rpcUrl=$2;                  shift 2 ;;
    -b | --block-num)               blockNum=$2;                shift 2 ;;
    -t | --timestamp)               timestamp=$2;               shift 2 ;;
    -p | --port)                    anvilPort=$2;               shift 2 ;;
    -h | --host)                    anvilHost=$2;               shift 2 ;;
    -c | --replace-code)            patchBytecode+=("$2");      shift 2 ;;
    --tmux)                         tmux=1;                     shift 1 ;;
    --help)                         usage;                      exit 0  ;;
    # -- means the end of the arguments; drop this, and break out of the while loop.
    --) shift; break ;;
    *) >&2 echo Unsupported option: $1
       usage ;;
  esac
done

# check for required flags.
isMissingFlag=0

[ -z $rpcUrl ] && echo "[NOTE] Flag --rpc-url Missing" && isMissingFlag=1
[ -z $blockNum ] && echo "[NOTE] Flag --block-num Missing" && isMissingFlag=1

if [ $isMissingFlag -eq 1 ]; then
  exit 1
fi

# build alto intance.
pnpm build

if [ -z $tmux ]; then
    # launch both instances in same terminal.
    anvil --fork-url $rpcUrl \
          --fork-block-number $blockNum \
          --timestamp  $timestamp &

    fund_accounts
    apply_bytecode_patches

    $projectRoot/alto --entryPoint $entryPoint \
                      --signerPrivateKeys $signerKey \
                      --utilityPrivateKey $utilityKey \
                      --rpcUrl http://$anvilHost:$anvilPort \
                      --minBalance 0
else
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
                                          --timestamp $timestamp" C-m

    fund_accounts
    apply_bytecode_patches

    # setup alto on pane 1
    tmux send-keys -t ${SESSION}.1 "$projectRoot/alto --rpcUrl http://$anvilHost:$anvilPort \
                                                      --entryPoint $entryPoint \
                                                      --signerPrivateKeys $signerKey \
                                                      --utilityPrivateKey $utilityKey \
                                                      --minBalance 0" C-m

    tmux attach-session -t $SESSION
fi

exit 0
