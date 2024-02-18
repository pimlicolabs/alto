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
Local mode will deploy the following contracts:
- [EntryPoint](https://github.com/eth-infinitism/account-abstraction/blob/develop/contracts/core/EntryPoint.sol) to address `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`
- [SimpleAccountFactory](https://github.com/eth-infinitism/account-abstraction/blob/develop/contracts/samples/SimpleAccount.sol) to address `0x9406Cc6185a346906296840746125a0E44976454`
- [BundleBulker](https://github.com/daimo-eth/bulk/blob/master/src/BundleBulker.sol) to address `0x000000000091A1F34f51CE866bEd8983dB51a97E`

```console
./run-local-instance.sh -l
```

> [!NOTE]
> Make sure you don't rename the repo when cloning. The script searches up for a directory named `alto` and treats it as the project root.

### Cli Flags + Options

```console
Usage: ./run-local-instance.sh [OPTIONS]
Utility to spawn a local alto instances linked to an anvil node.
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
```
