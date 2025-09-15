// Lua scripts for atomic Redis operations in the outstanding store
// These scripts run entirely on the Redis server, eliminating multiple roundtrips

export const LUA_SCRIPTS = {
    // Atomically pop the next operation from the queue
    POP_OPERATION: `
        local readyQueueKey = KEYS[1]
        local userOpHashLookupKey = KEYS[2]
        local factoryLookupKey = KEYS[3]

        -- Pop the highest priority pending ops key
        local popResult = redis.call('zpopmax', readyQueueKey, 1)
        if #popResult == 0 then
            return nil
        end

        local pendingOpsKey = popResult[1]

        -- Pop the lowest nonce operation from that set
        local opResult = redis.call('zpopmin', pendingOpsKey, 1)
        if #opResult == 0 then
            return nil
        end

        local userOpInfoStr = opResult[1]
        local userOpInfo = cjson.decode(userOpInfoStr)

        -- Remove from hash lookup
        redis.call('hdel', userOpHashLookupKey, userOpInfo.userOpHash)

        -- Clean up factory deployment if needed
        if userOpInfo.isDeployment then
            redis.call('hdel', factoryLookupKey, userOpInfo.userOp.sender)
        end

        -- Check if there are more operations in this set
        local nextOps = redis.call('zrange', pendingOpsKey, 0, 0, 'WITHSCORES')
        if #nextOps >= 2 then
            -- nextOps[1] is member, nextOps[2] is score
            local nextOpInfo = cjson.decode(nextOps[1])
            local gasPrice = tonumber(nextOpInfo.userOp.maxFeePerGas)

            -- Re-add to ready queue with next op's gas price
            redis.call('zadd', readyQueueKey, gasPrice, pendingOpsKey)
        end

        return userOpInfoStr
    `,

    // Atomically remove an operation and update ready queue
    REMOVE_OPERATION: `
        local pendingOpsKey = KEYS[1]
        local userOpHashLookupKey = KEYS[2]
        local factoryLookupKey = KEYS[3]
        local readyQueueKey = KEYS[4]

        local userOpHash = ARGV[1]
        local userOpInfoStr = ARGV[2]
        local isDeployment = ARGV[3] == "1"
        local sender = ARGV[4]

        -- Get all ops to check if this is the lowest nonce
        local allOps = redis.call('zrange', pendingOpsKey, 0, 1)
        local isLowestNonce = false

        if #allOps > 0 then
            local firstOp = cjson.decode(allOps[1])
            isLowestNonce = firstOp.userOpHash == userOpHash
        end

        -- Remove from sorted set
        local removed = redis.call('zrem', pendingOpsKey, userOpInfoStr)
        if removed == 0 then
            return 0
        end

        -- Remove from hash lookup
        redis.call('hdel', userOpHashLookupKey, userOpHash)

        -- Clean up factory deployment if needed
        if isDeployment then
            redis.call('hdel', factoryLookupKey, sender)
        end

        -- Update ready queue if this was the lowest nonce
        if isLowestNonce then
            -- Remove from ready queue
            redis.call('zrem', readyQueueKey, pendingOpsKey)

            -- Check if there's a next op
            local remainingOps = redis.call('zrange', pendingOpsKey, 0, 0)
            if #remainingOps > 0 then
                local nextOpInfo = cjson.decode(remainingOps[1])
                local gasPrice = tonumber(nextOpInfo.userOp.maxFeePerGas)

                -- Add back with next op's gas price
                redis.call('zadd', readyQueueKey, gasPrice, pendingOpsKey)
            end
        end

        return 1
    `,

    // Atomically add an operation with conflict detection
    ADD_OPERATION: `
        local pendingOpsKey = KEYS[1]
        local userOpHashLookupKey = KEYS[2]
        local factoryLookupKey = KEYS[3]
        local readyQueueKey = KEYS[4]

        local userOpInfoStr = ARGV[1]
        local userOpHash = ARGV[2]
        local nonceSeq = tonumber(ARGV[3])
        local isDeployment = ARGV[4] == "1"
        local sender = ARGV[5]
        local maxFeePerGas = tonumber(ARGV[6])

        -- Check if userOpHash already exists
        local exists = redis.call('hexists', userOpHashLookupKey, userOpHash)
        if exists == 1 then
            return {err = "Already exists"}
        end

        -- Check if this will be the lowest nonce
        local existingOps = redis.call('zrange', pendingOpsKey, 0, 0)
        local isLowestNonce = true

        if #existingOps > 0 then
            local firstOp = cjson.decode(existingOps[1])
            -- Compare nonces (stored as score)
            local firstOpScore = redis.call('zscore', pendingOpsKey, existingOps[1])
            isLowestNonce = nonceSeq < tonumber(firstOpScore)
        end

        -- Add to pending ops set
        redis.call('zadd', pendingOpsKey, nonceSeq, userOpInfoStr)

        -- Add to hash lookup
        redis.call('hset', userOpHashLookupKey, userOpHash, pendingOpsKey)

        -- Track factory deployment if needed
        if isDeployment then
            redis.call('hset', factoryLookupKey, sender, userOpHash)
        end

        -- Update ready queue if this is the lowest nonce
        if isLowestNonce then
            -- Remove any existing entry
            redis.call('zrem', readyQueueKey, pendingOpsKey)
            -- Add with this op's gas price
            redis.call('zadd', readyQueueKey, maxFeePerGas, pendingOpsKey)
        end

        return 1
    `,

    // Peek at the next operation without removing it
    PEEK_OPERATION: `
        local readyQueueKey = KEYS[1]

        -- Get highest priority queue key
        local queueKeys = redis.call('zrange', readyQueueKey, -1, -1)
        if #queueKeys == 0 then
            return nil
        end

        -- Get lowest nonce op from that queue
        local ops = redis.call('zrange', queueKeys[1], 0, 0)
        if #ops == 0 then
            return nil
        end

        return ops[1]
    `,

    // Check for conflicting operations
    CHECK_CONFLICTS: `
        local pendingOpsKey = KEYS[1]
        local factoryLookupKey = KEYS[2]

        local nonceSeq = tonumber(ARGV[1])
        local isDeployment = ARGV[2] == "1"
        local sender = ARGV[3]

        -- Check for same nonce
        local conflictingNonce = redis.call('zrangebyscore', pendingOpsKey, nonceSeq, nonceSeq)
        if #conflictingNonce > 0 then
            return conflictingNonce[1]
        end

        -- Check for deployment conflict
        if isDeployment then
            local existingHash = redis.call('hget', factoryLookupKey, sender)
            if existingHash then
                return existingHash
            end
        end

        return nil
    `
}

// Helper to prepare user op info for Lua scripts
export function prepareUserOpInfoForLua(userOpInfo: any): any {
    // Add isDeployment flag for easier checking in Lua
    const isDeployment =
        (userOpInfo.userOp.initCode && userOpInfo.userOp.initCode !== "0x") ||
        (userOpInfo.userOp.factory && userOpInfo.userOp.factory !== "0x")

    return {
        ...userOpInfo,
        isDeployment
    }
}