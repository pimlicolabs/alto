# Scripts For Local Testing

Simple bash script to deploy run a local alto and anvil instance in forked mode (uses state from mainnet).

### Cli Flags + Options

```console
Usage: ./run-local-fork.sh [OPTIONS]
Utility to spawn a local alto instances linked to an anvil node

Alto Options
   -e,  --entry-point       entryPoint contract address, 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789 (DEFAULT)

Anvil Options
   -r,  --rpc-url           RPC url to fork from
   -b,  --block-num         Fork block number
   -t,  --timestamp         Starting timestamp
   -p,  --port              Anvil port
   -h,  --host              IP Address
   -c,  --replace-code      Replace an addresses bytecode, usage: <address>,<bytecode-file>

Misc Options
   --help
   --tmux                   Launch anvil + alto in a tmux split
```


### Running

```console
./run-local-fork.sh --rpc-url <rpc> --block-num <some-block> ...
```
> `--rpc-url` and `--block-num` are required fields
