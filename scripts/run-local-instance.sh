#!/usr/bin/env bash
set -euo pipefail

bundleBulker=0x3Fde2701a9a5FC30b1F1916ec465A2F04BC7c05d
simpleAccountFactory=0x9406Cc6185a346906296840746125a0E44976454
entryPoint=0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789
rpcUrl=
blockNum=
tmux=
forkMode=
localMode=
signerKey=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # anvil default acc 0
utilityKey=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d # anvil default acc 1
anvilPort=8545
anvilHost=127.0.0.1
patchBytecode=()

projectRoot=`pwd | sed 's%\(.*/alto\)/.*%\1%'`

# helper functions.
usage(){
>&2 cat << EOF
Usage: $0 [OPTIONS]
Utility to quickly spawn a local alto instance linked to an anvil node.
*Must* be ran with either -l or -f flags.

Alto Options
   -e                       EntryPoint contract address, 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789 (DEFAULT)
   -l                       Local mode
   -f                       Fork mode (used for debugging)

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
            echo "ERR: wrong usage, failed to parse. correct usage: -c <address>,<bytecode-file>"
            exit 1
        fi

        patchedBytecode=$(cat $bytecodeFile | tr -d '\n')

        curl -H "Content-Type: application/json" \
            -X POST --data "{\"id\": \"4337\", \"jsonrpc\":\"2.0\", \"method\":\"anvil_setCode\", \"params\": [\"$contractAddr\", \"$patchedBytecode\"]}" \
            $anvilHost:$anvilPort

    done
}
deploy_contracts() {
    entryPointCall=0x0000000000000000000000000000000000000000000000000000000000000000$(cat $projectRoot/scripts/.entrypoint.bytecode | tr -d '\n')
    cast send 0x4e59b44847b379578588920ca78fbf26c0b4956c $entryPointCall \
        --private-key $utilityKey \
        --rpc-url http://$anvilHost:$anvilPort

    simpleAccountFactoryCall=0x0000000000000000000000000000000000000000000000000000000000000000$(cat $projectRoot/scripts/.simple-account-factory.bytecode | tr -d '\n')
    cast send 0x4e59b44847b379578588920ca78fbf26c0b4956c $simpleAccountFactoryCall \
        --private-key $utilityKey \
        --rpc-url http://$anvilHost:$anvilPort

    bundleBulkerCall=0x7cf7a0f0060e1519d0ee3e12e0ee57890f69d7aa693404299a3a779e90cd7921$(cat $projectRoot/scripts/.bundle-bulker.bytecode | tr -d '\n')
    cast send 0x4e59b44847b379578588920ca78fbf26c0b4956c $bundleBulkerCall \
        --private-key $utilityKey \
        --rpc-url http://$anvilHost:$anvilPort
}

while getopts "e:r:b:h:p:c:tfl" opt;
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
    f)
        forkMode=1
        ;;
    l)
        localMode=1
        ;;
  esac
done

# check for required flags.
if [ -n "$localMode" ] && [ -n "$forkMode" ]; then
    echo "[Err] Must be ran in either fork or local mode. Run again with either flag -f or -l." && exit 1
fi

if [ -z "$localMode" ] && [ -z "$forkMode" ]; then
    echo "[Err] Must be ran in either fork or local mode. Run again with either flag -f or -l." && exit 1
fi

if [ -n "$localMode" ]; then
    [ -n "$rpcUrl" ] && echo "[NOTE] Flag -r cannot be used in local mode" && exit 1
    [ -n "$blockNum" ] && echo "[NOTE] Flag -b cannot be used in local mode" && exit 1
elif [ -n "$forkMode" ]; then
    [ -z "$rpcUrl" ] && echo "[NOTE] Flag -r is missing, required in forking mode" && exit 1
    [ -z "$blockNum" ] && echo "[NOTE] Flag -b is missing, required in forking mode" && exit 1
fi

if [ -n "$localMode" ] && [ -z "$forkMode" ]; then
    # build alto intance.
    pnpm build

    if [ -z "$tmux" ]; then
        # launch both instances in same terminal.
        anvil &

        sleep 2
        deploy_contracts
        apply_bytecode_patches

        $projectRoot/alto --entryPoint $entryPoint \
                          --signerPrivateKeys $signerKey \
                          --utilityPrivateKey $utilityKey \
                          --rpcUrl http://$anvilHost:$anvilPort \
                          --minBalance 0 \
                          --networkName local \
                          --disableExpirationCheck true

    else
        # launch both instances in a tmux split.
        SESSION="anvil_alto_session"
        if tmux has-session -t $SESSION 2>/dev/null; then
            tmux kill-session -t $SESSION
        fi

        # create tmux session
        tmux new-session -d -s $SESSION
        tmux split-window -h -t $SESSION

        # setup anvil on pane 0
        tmux send-keys -t ${SESSION}.0 "anvil" C-m

        sleep 2
        deploy_contracts
        apply_bytecode_patches

        # setup alto on pane 1
        tmux send-keys -t ${SESSION}.1 "$projectRoot/alto --rpcUrl http://$anvilHost:$anvilPort \
                                                          --entryPoint $entryPoint \
                                                          --signerPrivateKeys $signerKey \
                                                          --utilityPrivateKey $utilityKey \
                                                          --minBalance 0 \
                                                          --networkName local \
                                                          --disableExpirationCheck true" C-m

        tmux attach-session -t $SESSION
    fi
fi

if [ -n $forkMode ] && [ -z "$localMode" ]; then
    forkTimestamp=$(cast block $blockNum --rpc-url $rpcUrl | grep time | awk '{print $2}' | tr -d '\n')

    # build alto intance.
    pnpm build

    if [ -z "$tmux" ]; then
        # launch both instances in same terminal.
        anvil --fork-url $rpcUrl \
              --fork-block-number $blockNum \
              --port $anvilPort \
              --timestamp  $forkTimestamp &

        sleep 2
        apply_bytecode_patches

        $projectRoot/alto --entryPoint $entryPoint \
                          --signerPrivateKeys $signerKey \
                          --bundleBulkerAddress 0x000000000091a1f34f51ce866bed8983db51a97e \
                          --perOpInflatorAddress 0x0000000000DD00D61091435B84D1371A1000de9a \
                          --utilityPrivateKey $utilityKey \
                          --rpcUrl http://$anvilHost:$anvilPort \
                          --noEthCallOverrideSupport true \
                          --noEip1559Support true \
                          --useUserOperationGasLimitForSubmission true \
                          --minBalance 0 \
                          --networkName local \
                          --disableExpirationCheck true
    else
        # launch both instances in a tmux split.
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
                                              --port $anvilPort \
                                              --timestamp $forkTimestamp" C-m

        sleep 2
        apply_bytecode_patches

        # setup alto on pane 1
        tmux send-keys -t ${SESSION}.1 "$projectRoot/alto --rpcUrl http://$anvilHost:$anvilPort \
                                                          --entryPoint $entryPoint \
                                                          --signerPrivateKeys $signerKey \
                                                          --bundleBulkerAddress 0x000000000091a1f34f51ce866bed8983db51a97e \
                                                          --perOpInflatorAddress 0x0000000000DD00D61091435B84D1371A1000de9a \
                                                          --utilityPrivateKey $utilityKey \
                                                          --minBalance 0 \
                                                          --networkName local \
                                                          --disableExpirationCheck true" C-m

        tmux attach-session -t $SESSION
    fi
fi

exit 0
