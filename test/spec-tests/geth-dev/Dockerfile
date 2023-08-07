FROM ethereum/client-go:release-1.10

ENTRYPOINT geth \
    --verbosity 2 \
    --http.vhosts '*,localhost,host.docker.internal' \
    --http \
    --http.api personal,eth,net,web3,debug \
    --http.corsdomain '*' \
    --http.addr "0.0.0.0" \
    --nodiscover --maxpeers 0 --mine \
    --networkid=31337 \
    --dev \
    --allow-insecure-unlock \
    --rpc.allow-unprotected-txs \
    --miner.gaslimit 12000000 \
    --miner.threads 1 \
    --dev.gaslimit 120000000 \
    --ignore-legacy-receipts
