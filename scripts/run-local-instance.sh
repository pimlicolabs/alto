#!/usr/bin/env bash
set -euo pipefail

rpcUrl=
blockNum=
tmux=
forkMode=
localMode=

projectRoot=`pwd | sed 's%\(.*/alto\)/.*%\1%'`

# helper functions.
usage(){
>&2 cat << EOF
Usage: $0 [OPTIONS]

Utility to quickly spawn a local alto instance linked to an anvil node.
*Must* be ran with either -l or -f flags.

Alto Options
   -l                       Local mode
   -f                       Fork mode (used for debugging)

Anvil Options
   -r <rpc-url>             RPC url to fork from
   -b <block-num>           Fork block number

Misc Options
   -t                       Launch anvil + alto in a tmux split

EOF
exit 1
}

while getopts "r:b:tflh" opt;
do
  case ${opt} in
    r)
        rpcUrl=$OPTARG
        ;;
    b)
        blockNum=$OPTARG
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
    h)
        usage
        exit 0
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
        pushd .
        cd $projectRoot
        pnpm ts-node scripts/localDeployer/index.ts
        popd

        $projectRoot/alto --config $projectRoot/scripts/config.local.json

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
        pushd .
        cd $projectRoot
        pnpm ts-node scripts/localDeployer/index.ts
        popd

        # setup alto on pane 1
        tmux send-keys -t ${SESSION}.1 "$projectRoot/alto --config $projectRoot/scripts/config.local.json" C-m

        tmux attach-session -t $SESSION
    fi
fi

if [ -n "$forkMode" ] && [ -z "$localMode" ]; then
    forkTimestamp=$(cast block $blockNum --rpc-url $rpcUrl | grep time | awk '{print $2}' | tr -d '\n')

    # build alto intance.
    pnpm build

    if [ -z "$tmux" ]; then
        # launch both instances in same terminal.
        anvil --fork-url $rpcUrl \
              --fork-block-number $blockNum \
              --timestamp  $forkTimestamp &

        sleep 2

        $projectRoot/alto --config $projectRoot/scripts/config.local.json

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
                                              --timestamp $forkTimestamp" C-m

        sleep 2

        # setup alto on pane 1
        tmux send-keys -t ${SESSION}.1 "$projectRoot/alto --config $projectRoot/scripts/config.local.json" C-m

        tmux attach-session -t $SESSION
    fi
fi

exit 0
