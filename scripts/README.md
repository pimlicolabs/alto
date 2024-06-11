# Scripts For Local Testing

Simple bash script to deploy and run a local alto + anvil instance in forked mode (uses state from mainnet).

### Running

The environment must be run in either **forked** or **local** mode.

#### Running in forked mode

Fork mode runs alto tied to a forked anvil instance. And is specified with the `-f` flag.

```
./run-local-instance.sh -f -r <rpc-url> -b <fork-block>
```

both flags `-r` (rpc url) and `-b` (block number) are required for forked mode.

#### Running in local mode

Local mode runs alto tied to a standard anvil instance. And is specified with the `-l` flag.
Local mode will deploy all 4337 related contracts.

```console
./run-local-instance.sh -l
```

> [!NOTE]
> Make sure you don't rename the repo when cloning. The script searches up for a directory named `alto` and treats it as the project root.

### Cli Flags + Options

```console
Usage: ./scripts/run-local-instance.sh [OPTIONS]

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
```
