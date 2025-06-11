#!/bin/bash

# Test script for API key authentication

echo "Testing API key authentication..."

# Test 1: Without API key (should fail)
echo -e "\n1. Testing protected method without API key (should fail):"
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_sendUserOperation","params":[],"id":1}'

# Test 2: With wrong API key (should fail)  
echo -e "\n\n2. Testing protected method with wrong API key (should fail):"
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -H "x-api-key: wrong-key" \
  -d '{"jsonrpc":"2.0","method":"eth_sendUserOperation","params":[],"id":2}'

# Test 3: With correct API key (should pass validation, might fail on params)
echo -e "\n\n3. Testing protected method with correct API key (should pass auth):"
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -H "x-api-key: test-api-key-123" \
  -d '{"jsonrpc":"2.0","method":"eth_sendUserOperation","params":[],"id":3}'

# Test 4: Testing unprotected method without API key (should work)
echo -e "\n\n4. Testing unprotected method without API key (should work):"
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":4}'

echo -e "\n\nDone!"